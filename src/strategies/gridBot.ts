// src/strategies/gridBot.ts
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { getExchange } from '../exchanges/ccxtClient';
import { CONFIG } from '../config';
import { Telegram } from '../alerts/telegram';
import { getPool } from '../db/pool';
import { runMigrations } from '../db/migrations';
import { RunsRepository, OrdersRepository, FillsRepository, InventoryRepository } from '../db/repositories';
import { reconcileOpenOrders } from '../services/reconciliation';
import { analyzeRegime } from '../analytics/regime';
import {
  MarketIntelligenceEngine,
  IntelligenceSummary,
  MarketMicrostructureSnapshot,
  NewsSentimentProvider,
} from '../analytics/intelligence';
import {
  CryptoCompareNewsSentimentProvider,
  CoinDeskNewsSentimentProvider,
} from '../services/intelligence/newsProvider';
import {
  GlassnodeOnChainMetricsProvider,
  PlaceholderOnChainMetricsProvider,
} from '../services/intelligence/onChainProvider';
import { RecentPerformanceService, RecentPerformanceMetrics } from '../services/performance/recentPerformance';
import {
  intelligenceCompositeGauge,
  intelligenceRiskBiasGauge,
  intelligenceVolatilityGauge,
  intelligencePerTradeGauge,
  intelligenceTakeProfitGauge,
} from '../telemetry/metrics';
import { RiskEngine, RiskEvaluationResult } from '../risk';
import { riskVaRGauge, riskStressLossGauge, riskKellyGauge } from '../telemetry/metrics';
import { orderReplacementCounter, orderCancelCounter, fillCounter, orderLatency } from '../telemetry/metrics';
import { circuitBreaker } from '../guard/circuitBreaker';
import { killSwitch } from '../guard/killSwitch';
import { GuardStateRepository } from '../db/guardStateRepo';
import { SpanStatusCode } from '@opentelemetry/api';
import { logger, setLogContext } from '../utils/logger';
import { retry } from '../utils/retry';
import { startSpan } from '../telemetry/tracing';
import { ClientConfigService } from '../services/clientConfig';
import { getRealtimeTicker } from '../services/marketData/realtimeTicker';
import { binanceStreamingGateway, StreamingSymbolHealth } from '../services/streaming/binanceGateway';

type ExchangeOrder = {
  id?: string;
  status?: string;
  filled?: number;
  remaining?: number;
  average?: number;
  price?: number;
  timestamp?: number;
  fee?: { cost?: number } | null;
};

type ExchangeTicker = {
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  timestamp?: number;
};

type ExchangeTickerWithMeta = ExchangeTicker & {
  source?: 'ws' | 'rest';
  latencyMs?: number;
};

const ORDER_POLL_INTERVAL_MS = 5000;
const ORDER_TIMEOUT_MS = 1000 * 60 * 30;
const EXCHANGE_RETRY_ATTEMPTS = CONFIG.EXCHANGE_RETRY.ATTEMPTS;
const EXCHANGE_RETRY_DELAY_MS = CONFIG.EXCHANGE_RETRY.DELAY_MS;
const EXCHANGE_RETRY_BACKOFF = CONFIG.EXCHANGE_RETRY.BACKOFF;
const CSV_PATH = path.resolve(process.cwd(), 'planned_trades.csv');
const DEFAULT_PLAN_JSON_PATH = path.resolve(process.cwd(), 'planned_summary.json');
const CSV_HEADERS = ['timestamp', 'pair', 'side', 'price', 'amount', 'status', 'note', 'runId', 'correlationId'];

// fallback fee if exchange metadata isn't available
const FALLBACK_FEE_PCT = 0.0004; // 0.04%

export type PlannedSummary = ReturnType<typeof summarizePlanned>;

function parseJsonOr<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function getBaseAssetFromPair(pair: string): string {
  const [base] = pair.split(/[/:_-]/g);
  return base?.toUpperCase?.() ?? pair;
}

const newsSentimentCategories = (process.env.NEWS_SENTIMENT_CATEGORIES || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const cryptoCompareNewsProvider = process.env.CRYPTOCOMPARE_API_KEY
  ? new CryptoCompareNewsSentimentProvider({
      apiKey: process.env.CRYPTOCOMPARE_API_KEY,
      categories: newsSentimentCategories,
    })
  : null;

const coinDeskNewsProvider = new CoinDeskNewsSentimentProvider({
  apiKey: process.env.COINDESK_API_KEY,
});

const cascadingNewsProvider: NewsSentimentProvider | undefined = (() => {
  const providers: NewsSentimentProvider[] = [];
  if (cryptoCompareNewsProvider) providers.push(cryptoCompareNewsProvider);
  providers.push(coinDeskNewsProvider);
  if (!providers.length) return undefined;
  return {
    async fetchLatestSentiment(pair: string) {
      for (const provider of providers) {
        try {
          const result = await provider.fetchLatestSentiment(pair);
          if (result) return result;
        } catch (error) {
          logger.debug('news_sentiment_provider_failed', {
            event: 'news_sentiment_provider_failed',
            provider: provider.constructor?.name ?? 'unknown',
            pair,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return null;
    },
  };
})();

const onChainProviderInstance = process.env.GLASSNODE_API_KEY
  ? new GlassnodeOnChainMetricsProvider({ apiKey: process.env.GLASSNODE_API_KEY })
  : new PlaceholderOnChainMetricsProvider();

const sectorLimitConfig = parseJsonOr<Record<string, number>>(process.env.RISK_SECTOR_LIMITS, {
  general: 0.4,
});

const correlationLimitConfig = parseJsonOr<Record<string, number>>(process.env.RISK_CORRELATION_LIMITS, {
  general: 0.6,
});

const assetSectorMap = parseJsonOr<Record<string, string>>(process.env.RISK_ASSET_SECTOR_MAP, {});
const assetCorrelationMap = parseJsonOr<Record<string, string>>(process.env.RISK_ASSET_CORRELATION_MAP, {});

const stressScenarioConfig = parseJsonOr<Array<{ name: string; shockPct: number; maxFractionOfBankroll?: number }>>(
  process.env.RISK_STRESS_SCENARIOS,
  [
    { name: 'flash_crash', shockPct: 0.25, maxFractionOfBankroll: 0.15 },
    { name: 'volatility_spike', shockPct: 0.18, maxFractionOfBankroll: 0.12 },
    { name: 'tail_event', shockPct: 0.35, maxFractionOfBankroll: 0.2 },
  ]
);

export type PlannedTrade = {
  timestamp: string;
  pair: string;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  status: 'planned' | 'placed' | 'filled' | 'cancelled';
  note?: string;
  runId: string;
  correlationId?: string;
};

export type GridBuyLevel = {
  price: number;
  amount: number;
  perTradeUsd: number;
  adjusted?: boolean;
  adjustReason?: string;
  correlationId?: string;
};

export type GridPlan = {
  runId: string;
  runMode: 'summary' | 'paper' | 'live';
  pair: string;
  generatedAt: string;
  gridSteps: number;
  gridSizePct: number;
  perTradeUsd: number;
  feePct: number;
  buyLevels: GridBuyLevel[];
  summary: PlannedSummary | null;
  metadata: {
    mid: number;
    tickerBid: number;
    tickerAsk: number;
    stepSize: number;
    basePrecision: number;
    minNotional: number | null;
    regime?: any;
    portfolioAllocationUsd?: number | null;
    portfolioWeightPct?: number | null;
    intelligence?: IntelligenceSummary | null;
    risk?: RiskEvaluationResult | null;
  };
  plannedExposureUsd: number;
};

let csvHeaderEnsured = false;

function ensureCsvHeader() {
  if (csvHeaderEnsured) return;
  if (!fs.existsSync(CSV_PATH)) {
    fs.writeFileSync(CSV_PATH, `${CSV_HEADERS.join(',')}\n`);
    csvHeaderEnsured = true;
    return;
  }

  const fileContents = fs.readFileSync(CSV_PATH, 'utf8');
  const [firstLine, ...rest] = fileContents.split(/\r?\n/);
  if (firstLine === CSV_HEADERS.join(',')) {
    csvHeaderEnsured = true;
    return;
  }

  if (firstLine && !firstLine.includes('runId')) {
    const updated = [CSV_HEADERS.join(','), ...rest].join('\n');
    fs.writeFileSync(CSV_PATH, updated);
  }
  csvHeaderEnsured = true;
}

function appendCsvRow(row: PlannedTrade) {
  ensureCsvHeader();
  const values = [
    row.timestamp,
    row.pair,
    row.side,
    String(row.price),
    String(row.amount),
    row.status,
    row.note || '',
    row.runId,
    row.correlationId || '',
  ];
  fs.appendFileSync(CSV_PATH, `${values.join(',')}\n`);
}

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function errorMessage(err: unknown) {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : JSON.stringify(err);
}

function createTimestampProvider(isPaperMode: boolean) {
  if (!isPaperMode) {
    return () => new Date().toISOString();
  }

  const baseCandidate = process.env.PAPER_MODE_BASE_TS || '2020-01-01T00:00:00.000Z';
  let baseMs = Date.parse(baseCandidate);
  if (Number.isNaN(baseMs)) {
    baseMs = Date.parse('2020-01-01T00:00:00.000Z');
  }
  let counter = 0;
  return () => {
    const timestamp = new Date(baseMs + counter * 1000).toISOString();
    counter += 1;
    return timestamp;
  };
}

function maybeWritePlanJson(plan: GridPlan) {
  const explicitPath = process.env.PLAN_JSON_PATH || process.env.SUMMARY_JSON_PATH;
  const shouldWriteDefault = (process.env.SUMMARY_JSON_EXPORT || '').toLowerCase() === 'true';
  if (!explicitPath && !shouldWriteDefault) {
    return;
  }

  const targetPath = explicitPath ? path.resolve(process.cwd(), explicitPath) : DEFAULT_PLAN_JSON_PATH;
  fs.writeFileSync(targetPath, JSON.stringify(plan, null, 2));
  logger.info('plan_json_written', {
    event: 'plan_json_written',
    runId: plan.runId,
    pair: plan.pair,
    path: targetPath,
  });
}

function generateRunId(params: {
  explicit?: string | undefined;
  runMode: GridPlan['runMode'];
  pair: string;
  gridSteps: number;
  gridSizePct: number;
  perTradeUsd: number;
  feePct: number;
  mid: number;
  buyLevels: GridBuyLevel[];
}) {
  if (params.explicit) return params.explicit;
  if (params.runMode === 'live') {
    return crypto.randomUUID();
  }

  const hash = crypto.createHash('sha1');
  hash.update(
    JSON.stringify({
      pair: params.pair,
      mode: params.runMode,
      gridSteps: params.gridSteps,
      gridSizePct: params.gridSizePct,
      perTradeUsd: Number(params.perTradeUsd.toFixed(12)),
      feePct: Number(params.feePct.toFixed(12)),
      mid: Number(params.mid.toFixed(12)),
      exchange: CONFIG.DEFAULT_EXCHANGE,
      levels: params.buyLevels.map((lvl) => [Number(lvl.price.toFixed(12)), Number(lvl.amount.toFixed(12))]),
    })
  );
  return hash.digest('hex').slice(0, 16);
}

function acquirePairLock(pair: string, runId: string): () => void {
  const locksDir = path.resolve(process.cwd(), '.gridbot-locks');
  fs.mkdirSync(locksDir, { recursive: true });
  const safePair = pair.replace(/[^a-zA-Z0-9_-]/g, '_');
  const lockPath = path.join(locksDir, `${safePair}.lock`);

  try {
    const fd = fs.openSync(lockPath, 'wx');
    fs.writeFileSync(fd, JSON.stringify({ runId, pair, createdAt: new Date().toISOString() }));
    fs.closeSync(fd);
  } catch (err: any) {
    if (err && err.code === 'EEXIST') {
      logger.warn('pair_lock_exists', {
        event: 'pair_lock_exists',
        pair,
        runId,
        lockPath,
      });
      throw new Error(`Lock already present for ${pair}; refusing to start new run (lock: ${lockPath}).`);
    }
    throw err;
  }

  return () => {
    try {
      fs.unlinkSync(lockPath);
    } catch (err: any) {
      if (err && err.code !== 'ENOENT') {
        logger.warn('lock_release_failed', {
          event: 'lock_release_failed',
          lockPath,
          runId,
          pair,
          error: errorMessage(err),
        });
      }
    }
  };
}

function captureRateLimitMeta(ex: any) {
  if (!ex) return null;
  return {
    rateLimit: ex.rateLimit ?? null,
    enableRateLimit: ex.enableRateLimit ?? null,
    has: ex.has ?? null,
    options: ex.options ?? null,
  };
}

function captureMarketSnapshot(
  pair: string,
  ticker: any,
  meta: {
    stepSize: number;
    basePrecision: number;
    minNotional: number | null;
  }
) {
  return {
    pair,
    bid: ticker?.bid ?? null,
    ask: ticker?.ask ?? null,
    mid: ticker && ticker.bid && ticker.ask ? (ticker.bid + ticker.ask) / 2 : null,
    timestamp: ticker?.timestamp ?? Date.now(),
    stepSize: meta.stepSize,
    basePrecision: meta.basePrecision,
    minNotional: meta.minNotional,
  };
}

async function collectMicrostructureSnapshots(ex: any, pair: string, midFallback: number): Promise<MarketMicrostructureSnapshot[]> {
  try {
    const [orderBook, trades] = await Promise.all([
      typeof ex.fetchOrderBook === 'function' ? ex.fetchOrderBook(pair, 10).catch(() => null) : Promise.resolve(null),
      typeof ex.fetchTrades === 'function' ? ex.fetchTrades(pair, 25).catch(() => null) : Promise.resolve(null),
    ]);

    if (!orderBook || !orderBook.bids || !orderBook.asks) {
      return [];
    }

    const bestBid = orderBook.bids.length ? Number(orderBook.bids[0][0]) : midFallback;
    const bestAsk = orderBook.asks.length ? Number(orderBook.asks[0][0]) : midFallback;
    const bidVolume = orderBook.bids.slice(0, 5).reduce((sum: number, lvl: [number, number]) => sum + Number(lvl[1]), 0);
    const askVolume = orderBook.asks.slice(0, 5).reduce((sum: number, lvl: [number, number]) => sum + Number(lvl[1]), 0);

    let tradesBuyVolume = 0;
    let tradesSellVolume = 0;
    if (Array.isArray(trades)) {
      for (const trade of trades) {
        const amount = Number(trade.amount ?? trade.qty ?? 0);
        if (!Number.isFinite(amount) || amount <= 0) continue;
        const side = typeof trade.side === 'string' ? trade.side.toLowerCase() : '';
        if (side === 'buy') tradesBuyVolume += amount;
        else if (side === 'sell') tradesSellVolume += amount;
        else if (trade.takerOrMaker === 'maker') tradesSellVolume += amount;
        else if (trade.takerOrMaker === 'taker') tradesBuyVolume += amount;
      }
    }

    return [
      {
        bid: Number.isFinite(bestBid) ? bestBid : midFallback,
        ask: Number.isFinite(bestAsk) ? bestAsk : midFallback,
        bidVolume,
        askVolume,
        tradesBuyVolume,
        tradesSellVolume,
        timestamp: Date.now(),
      },
    ];
  } catch {
    return [];
  }
}

function riskStanceToNumber(st: IntelligenceSummary['regime']['suggestedRiskStance']): number {
  switch (st) {
    case 'increase':
      return 1;
    case 'decrease':
      return -1;
    default:
      return 0;
  }
}

type ExchangeExecution = {
  id?: string;
  createLimitBuyOrder: (symbol: string, amount: number, price: number) => Promise<any>;
  createLimitSellOrder: (symbol: string, amount: number, price: number) => Promise<any>;
  fetchOrder: (id: string, symbol: string) => Promise<any>;
  cancelOrder: (id: string, symbol: string) => Promise<any>;
  fetchTicker: (symbol: string) => Promise<any>;
};

class RateLimiter {
  private queue: Promise<void> = Promise.resolve();
  private last = 0;
  private intervalMs: number;

  constructor(intervalMs: number) {
    this.intervalMs = intervalMs;
  }

  updateInterval(intervalMs: number) {
    this.intervalMs = intervalMs;
  }

  getIntervalMs() {
    return this.intervalMs;
  }

  async wait() {
    const prev = this.queue;
    let release: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    const now = Date.now();
    const waitFor = Math.max(0, this.last + this.intervalMs - now);
    if (waitFor > 0) {
      await sleep(waitFor);
    }
    this.last = Date.now();
    release!();
  }
}

async function mapWithConcurrency<T>(items: T[], concurrency: number, iterator: (item: T, index: number) => Promise<void>) {
  if (concurrency <= 1) {
    for (let i = 0; i < items.length; i += 1) {
      await iterator(items[i], i);
    }
    return;
  }
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) break;
      await iterator(items[index], index);
    }
  });
  await Promise.all(workers);
}

const DEFAULT_ORDER_CONCURRENCY = 3;
const DEFAULT_ORDER_RATE_INTERVAL_MS = 250;
const DEFAULT_REPLACE_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_REPLACE_SLIPPAGE_PCT = 0.003;
const DEFAULT_REPLACE_MAX_RETRIES = 3;

const clientLimiterRegistry = new Map<string, RateLimiter>();

function getClientRateLimiter(clientId: string, intervalMs: number) {
  const safeInterval = Math.max(0, intervalMs);
  const existing = clientLimiterRegistry.get(clientId);
  if (existing) {
    if (safeInterval > existing.getIntervalMs()) {
      existing.updateInterval(safeInterval);
    }
    return existing;
  }
  const limiter = new RateLimiter(safeInterval);
  clientLimiterRegistry.set(clientId, limiter);
  return limiter;
}

interface OrderExecutionState {
  totalFilled: number;
  tpPlaced: number;
}

interface ExecutionMetrics {
  buyReplacements: number;
  sellReplacements: number;
  buyCancels: number;
  sellCancels: number;
}

export interface OrderExecutionContext {
  clientId: string;
  exchange: ExchangeExecution;
  pair: string;
  plan: GridPlan;
  takeProfitPct: number;
  marketMeta: { stepSize: number; basePrecision: number; minNotional: number | null };
  gridSizePct: number;
  timestampProvider: () => string;
  ordersRepo: OrdersRepository;
  fillsRepo: FillsRepository;
  buyLevels: GridBuyLevel[];
  appendCsv: (row: PlannedTrade) => void;
  sendNotification?: (message: string) => Promise<void>;
  metrics?: ExecutionMetrics;
  pendingTpPromises?: Promise<void>[];
  limiter?: RateLimiter;
  fetchTicker: () => Promise<ExchangeTickerWithMeta>;
}

export async function executeBuyLevels(context: OrderExecutionContext) {
  const span = startSpan('execute_buy_levels', {
    clientId: context.clientId,
    pair: context.pair,
    gridSteps: context.buyLevels.length,
  });
  try {
  const orderConcurrency = Number(process.env.ORDER_CONCURRENCY || DEFAULT_ORDER_CONCURRENCY);
  const rateIntervalMs = Number(process.env.ORDER_RATE_INTERVAL_MS || DEFAULT_ORDER_RATE_INTERVAL_MS);
  const replaceTimeoutMs = Number(process.env.REPLACE_TIMEOUT_MS || DEFAULT_REPLACE_TIMEOUT_MS);
  const replaceSlippagePct = Number(process.env.REPLACE_SLIPPAGE_PCT || DEFAULT_REPLACE_SLIPPAGE_PCT);
  const replaceMaxRetries = Number(process.env.REPLACE_MAX_RETRIES || DEFAULT_REPLACE_MAX_RETRIES);

  const limiterIntervalMs = Math.max(0, rateIntervalMs);
  if (!context.limiter) {
    context.limiter = getClientRateLimiter(context.clientId, limiterIntervalMs);
  }
  context.metrics = context.metrics ?? {
    buyReplacements: 0,
    sellReplacements: 0,
    buyCancels: 0,
    sellCancels: 0,
  };
  context.pendingTpPromises = context.pendingTpPromises ?? [];

  const notify = context.sendNotification
    ? context.sendNotification
    : async (msg: string) => {
        await Telegram.sendMessage(msg);
      };

  if (killSwitch.isActive()) {
    await cancelOpenOrdersForRun(context);
    throw new Error(`Kill switch active: ${killSwitch.getReason()}`);
  }

  await mapWithConcurrency(context.buyLevels, Math.max(1, orderConcurrency), async (level, index) => {
    const state: OrderExecutionState = { totalFilled: 0, tpPlaced: 0 };
    const baseCorrelation = level.correlationId || `${context.plan.runId}-lvl${String(index + 1).padStart(2, '0')}`;
    let attempt = 0;
    let currentPrice = level.price;

    context.appendCsv({
      timestamp: context.timestampProvider(),
      pair: context.pair,
      side: 'buy',
      price: level.price,
      amount: level.amount,
      status: 'planned',
      note: 'Grid buy planned',
      runId: context.plan.runId,
      correlationId: baseCorrelation,
    });

    while (state.totalFilled + context.marketMeta.stepSize / 2 < level.amount && attempt <= replaceMaxRetries) {
      await context.limiter!.wait();
      if (killSwitch.isActive()) {
        context.metrics!.buyCancels += 1;
        orderCancelCounter.labels(context.clientId, 'buy').inc();
        throw new Error(`Kill switch active: ${killSwitch.getReason()}`);
      }
      const remainingTarget = Math.max(level.amount - state.totalFilled, context.marketMeta.stepSize);
      const correlationId = attempt === 0 ? baseCorrelation : `${baseCorrelation}-r${attempt}`;
      const orderContext = {
        context,
        level,
        remainingTarget,
        price: currentPrice,
        correlationId,
        state,
        attempt,
        replaceTimeoutMs,
        replaceSlippagePct,
      };
      let result: { needsReplacement: boolean; nextPrice?: number } | null | undefined;
      try {
        result = await placeAndMonitorOrder(orderContext, notify);
      } catch (err) {
        context.metrics!.buyCancels += 1;
        logger.error('buy_order_failed', {
          event: 'buy_order_failed',
          runId: context.plan.runId,
          pair: context.pair,
          correlationId,
          error: errorMessage(err),
        });
        if (!killSwitch.isActive()) {
          circuitBreaker.recordApiError('buy_order_flow');
        }
        await cancelOpenOrdersForRun(context);
        break;
      }
      if (!result || !result.needsReplacement) break;
      currentPrice = result.nextPrice ?? currentPrice;
      attempt += 1;
    }

    if (state.totalFilled + context.marketMeta.stepSize / 2 < level.amount) {
      logger.warn('level_incomplete', {
        event: 'level_incomplete',
        runId: context.plan.runId,
        pair: context.pair,
        targetAmount: level.amount,
        filledAmount: state.totalFilled,
        correlationId: baseCorrelation,
      });
    }
  });

  if (context.pendingTpPromises.length) {
    await Promise.all(context.pendingTpPromises);
  }

  logger.info('execution_metrics', {
    event: 'execution_metrics',
    runId: context.plan.runId,
    pair: context.pair,
    metrics: context.metrics,
    clientId: context.clientId,
  });
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: errorMessage(error),
    });
    throw error;
  } finally {
    span.end();
  }
}

async function cancelOpenOrdersForRun(context: OrderExecutionContext) {
  const openOrders = await context.ordersRepo.getOpenOrdersForRun(context.plan.runId);
  for (const order of openOrders) {
    if (!order.exchange_order_id) continue;
    const side = (order.side as 'buy' | 'sell') || 'buy';
    try {
      await context.exchange.cancelOrder(order.exchange_order_id, context.pair);
      orderCancelCounter.labels(context.clientId, side).inc();
      if (side === 'buy') context.metrics!.buyCancels += 1;
      else context.metrics!.sellCancels += 1;
      await context.ordersRepo.updateOrder({
        orderId: order.id,
        status: 'cancelled',
        driftReason: 'kill-switch',
      });
    } catch (err) {
      logger.warn('cancel_open_order_failed', {
        event: 'cancel_open_order_failed',
        runId: context.plan.runId,
        pair: context.pair,
        orderId: order.exchange_order_id,
        error: errorMessage(err),
        clientId: context.clientId,
      });
      circuitBreaker.recordApiError('cancel_order');
    }
  }
}

async function placeAndMonitorOrder(
  params: {
    context: OrderExecutionContext;
    level: GridBuyLevel;
    remainingTarget: number;
    price: number;
    correlationId: string;
    state: OrderExecutionState;
    attempt: number;
    replaceTimeoutMs: number;
    replaceSlippagePct: number;
  },
  notify: (message: string) => Promise<void>
) {
  const {
    context,
    level,
    remainingTarget,
    price,
    correlationId,
    state,
    replaceTimeoutMs,
    replaceSlippagePct,
  } = params;
  const { exchange, pair, takeProfitPct, marketMeta, timestampProvider, ordersRepo, fillsRepo, gridSizePct } = context;

  const buyAdjust = adjustPerTradeToExchange(remainingTarget * price, price, marketMeta.stepSize, marketMeta.basePrecision, marketMeta.minNotional);
  let orderAmount = Math.min(remainingTarget, buyAdjust.amount || remainingTarget);
  if (orderAmount <= 0) {
    orderAmount = Math.max(remainingTarget, marketMeta.stepSize);
  }
  const orderPrice = Number(price.toFixed(8));

  let exchangeOrder: ExchangeOrder;
  try {
    exchangeOrder = await retry<ExchangeOrder>(
      () => exchange.createLimitBuyOrder(pair, orderAmount, orderPrice),
      {
        attempts: EXCHANGE_RETRY_ATTEMPTS,
        delayMs: EXCHANGE_RETRY_DELAY_MS,
        backoffFactor: EXCHANGE_RETRY_BACKOFF,
        onRetry: (error, attempt) => {
          circuitBreaker.recordApiError('create_buy_order');
          logger.warn('create_buy_order_retry', {
            event: 'create_buy_order_retry',
            runId: context.plan.runId,
            pair,
            correlationId,
            attempt,
            error: errorMessage(error),
          });
        },
      }
    );
  } catch (err) {
    circuitBreaker.recordApiError('create_buy_order');
    context.metrics!.buyCancels += 1;
    orderCancelCounter.labels(context.clientId, 'buy').inc();
    throw err;
  }
  await notify(`Placed BUY order ${pair} ${orderAmount}@${orderPrice} id:${exchangeOrder.id}`);
  const dbOrder = await ordersRepo.insertOrder({
    runId: context.plan.runId,
    exchangeOrderId: exchangeOrder.id,
    pair,
    side: 'buy',
    price: orderPrice,
    amount: orderAmount,
    status: 'placed',
    correlationId,
    raw: exchangeOrder as any,
  });

  context.appendCsv({
    timestamp: timestampProvider(),
    pair,
    side: 'buy',
    price: orderPrice,
    amount: orderAmount,
    status: 'placed',
    note: `order_id=${exchangeOrder.id}`,
    runId: context.plan.runId,
    correlationId,
  });

  let orderFilled = 0;
  let lastFillPrice = orderPrice;
  const orderStart = Date.now();
  const pollInterval = Number(process.env.ORDER_POLL_INTERVAL_MS || ORDER_POLL_INTERVAL_MS);

  while (true) {
    await sleep(pollInterval);
    if (killSwitch.isActive()) {
      context.metrics!.buyCancels += 1;
      orderCancelCounter.labels(context.clientId, 'buy').inc();
      throw new Error(`Kill switch active: ${killSwitch.getReason()}`);
    }
    const orderId = exchangeOrder.id;
    if (!orderId) {
      logger.warn('exchange_order_missing_id', {
        event: 'exchange_order_missing_id',
        runId: context.plan.runId,
        pair,
        correlationId,
      });
      break;
    }

    let updated: ExchangeOrder;
    try {
      updated = await retry<ExchangeOrder>(
        () => exchange.fetchOrder(orderId, pair),
        {
          attempts: EXCHANGE_RETRY_ATTEMPTS,
          delayMs: EXCHANGE_RETRY_DELAY_MS,
          backoffFactor: EXCHANGE_RETRY_BACKOFF,
          onRetry: (error, attempt) => {
            circuitBreaker.recordApiError('fetch_order');
            logger.warn('fetch_order_retry', {
              event: 'fetch_order_retry',
              runId: context.plan.runId,
              pair,
              correlationId,
              orderId,
              attempt,
              error: errorMessage(error),
            });
          },
        }
      );
    } catch (err) {
      logger.warn('fetch_order_failed', {
        event: 'fetch_order_failed',
        runId: context.plan.runId,
        pair,
        correlationId,
        orderId,
        error: errorMessage(err),
      });
      await ordersRepo.updateOrder({
        orderId: dbOrder.id,
        status: 'placed',
        driftReason: errorMessage(err),
      });
      circuitBreaker.recordApiError('fetch_order');
      continue;
    }

    const statusLower = (updated.status || '').toLowerCase();
    const isClosed = statusLower === 'closed' || statusLower === 'filled';
    const filled = Number(updated.filled ?? 0);
    const delta = Math.max(0, filled - orderFilled);
    if (delta > 0) {
      orderFilled = filled;
      state.totalFilled += delta;
      lastFillPrice = updated.average ?? updated.price ?? lastFillPrice;
      await ordersRepo.updateOrder({
        orderId: dbOrder.id,
        status: filled >= orderAmount ? 'closed' : 'partial',
        filledAmount: filled,
        remainingAmount: Math.max(orderAmount - filled, 0),
        raw: updated as any,
      });
      await fillsRepo.insertFill({
        orderId: dbOrder.id,
        runId: context.plan.runId,
        pair,
        price: lastFillPrice,
        amount: delta,
        side: 'buy',
        fillTimestamp: updated.timestamp ? new Date(updated.timestamp) : new Date(),
        raw: updated as any,
      });
      fillCounter.labels(context.clientId, 'buy').inc(delta);
      circuitBreaker.recordFill('buy', lastFillPrice, delta, updated.fee?.cost ?? 0);
      logger.info('buy_fill_delta', {
        event: 'buy_fill_delta',
        runId: context.plan.runId,
        pair,
        correlationId,
        delta,
        totalFilled: orderFilled,
      });
    }

    const orderRemaining = Math.max(orderAmount - orderFilled, 0);
    const elapsed = Date.now() - orderStart;
    const referencePrice = Number(updated.price ?? lastFillPrice ?? orderPrice);
    const priceDelta = Math.abs(referencePrice - orderPrice) / orderPrice;
    const needsReplacement =
      orderRemaining > marketMeta.stepSize / 2 && (elapsed > replaceTimeoutMs || priceDelta > replaceSlippagePct);

    if (orderRemaining <= marketMeta.stepSize / 2 || isClosed) {
      const pendingTp = state.totalFilled - state.tpPlaced;
      if (pendingTp > marketMeta.stepSize / 2) {
        await placeTakeProfit({
          context,
          amount: pendingTp,
          filledPrice: lastFillPrice,
          takeProfitPct,
          correlationId,
          timestampProvider,
          appendCsv: context.appendCsv,
        });
        state.tpPlaced += pendingTp;
      }
      logger.info('buy_order_filled', {
        event: 'buy_order_filled',
        runId: context.plan.runId,
        pair,
        correlationId,
        orderId: exchangeOrder.id,
        amount: orderFilled,
        price: lastFillPrice,
        clientId: context.clientId,
      });
      await notify(`BUY filled ${pair} ${orderFilled}@${lastFillPrice} (order ${exchangeOrder.id})`);
      orderLatency.labels(context.clientId, 'buy').observe(Date.now() - orderStart);
      return { needsReplacement: false };
    }

    if (needsReplacement) {
      await retry(
        () => exchange.cancelOrder(orderId, pair),
        {
          attempts: EXCHANGE_RETRY_ATTEMPTS,
          delayMs: EXCHANGE_RETRY_DELAY_MS,
          backoffFactor: EXCHANGE_RETRY_BACKOFF,
          onRetry: (error, attempt) => {
            circuitBreaker.recordApiError('cancel_order');
            logger.warn('cancel_order_retry', {
              event: 'cancel_order_retry',
              runId: context.plan.runId,
              pair,
              orderId,
              attempt,
              error: errorMessage(error),
            });
          },
        }
      ).catch((error) => {
        logger.warn('cancel_order_failed', {
          event: 'cancel_order_failed',
          runId: context.plan.runId,
          pair,
          orderId,
          error: errorMessage(error),
        });
      });
      await ordersRepo.updateOrder({
        orderId: dbOrder.id,
        status: 'cancelled',
        filledAmount: orderFilled,
        remainingAmount: orderRemaining,
        driftReason: elapsed > replaceTimeoutMs ? 'timeout' : `price-drift ${priceDelta.toFixed(4)}`,
        raw: updated as any,
      });
      context.metrics!.buyReplacements += 1;
      orderReplacementCounter.labels(context.clientId, 'buy').inc();

      const pendingTp = state.totalFilled - state.tpPlaced;
      if (pendingTp > marketMeta.stepSize / 2) {
        await placeTakeProfit({
          context,
          amount: pendingTp,
          filledPrice: lastFillPrice,
          takeProfitPct,
          correlationId,
          timestampProvider,
          appendCsv: context.appendCsv,
        });
        state.tpPlaced += pendingTp;
      }

      const ticker = await retry<ExchangeTickerWithMeta>(
        () => context.fetchTicker(),
        {
          attempts: EXCHANGE_RETRY_ATTEMPTS,
          delayMs: EXCHANGE_RETRY_DELAY_MS,
          backoffFactor: EXCHANGE_RETRY_BACKOFF,
          onRetry: (error, attempt) => {
            circuitBreaker.recordApiError('fetch_ticker');
            logger.warn('fetch_ticker_retry', {
              event: 'fetch_ticker_retry',
              runId: context.plan.runId,
              pair,
              attempt,
              error: errorMessage(error),
            });
          },
        }
      );
      circuitBreaker.recordTicker({
        timestamp: ticker.timestamp ?? Date.now(),
        source: ticker.source ?? null,
        latencyMs: ticker.latencyMs ?? null,
        symbol: pair,
      });
      circuitBreaker.checkStaleData();
      const basePriceCandidate = typeof ticker.bid === 'number'
        ? ticker.bid
        : typeof ticker.last === 'number'
          ? ticker.last
          : referencePrice;
      const basePrice = basePriceCandidate || referencePrice;
      const adjustedPrice = Number((basePrice * (1 - replaceSlippagePct / 2)).toFixed(8));

      logger.warn('buy_order_replaced', {
        event: 'buy_order_replaced',
        runId: context.plan.runId,
        pair,
        correlationId,
        orderId: exchangeOrder.id,
        remaining: orderRemaining,
        nextPrice: adjustedPrice,
        clientId: context.clientId,
      });

      return {
        needsReplacement: true,
        nextPrice: adjustedPrice,
      };
    }
  }
}

async function placeTakeProfit(params: {
  context: OrderExecutionContext;
  amount: number;
  filledPrice: number;
  takeProfitPct: number;
  correlationId: string;
  timestampProvider: () => string;
  appendCsv: (row: PlannedTrade) => void;
}) {
  const { context, amount, filledPrice, takeProfitPct, correlationId, timestampProvider, appendCsv } = params;
  const sellPrice = Number((filledPrice * (1 + takeProfitPct)).toFixed(8));
  const sellAdjust = adjustPerTradeToExchange(amount * sellPrice, sellPrice, context.marketMeta.stepSize, context.marketMeta.basePrecision, context.marketMeta.minNotional);
  let sellAmount = Math.min(amount, sellAdjust.amount || amount);
  if (sellAmount <= 0) return;

  await context.limiter!.wait();
  let sellOrder: ExchangeOrder;
  try {
    sellOrder = await retry<ExchangeOrder>(
      () => context.exchange.createLimitSellOrder(context.pair, sellAmount, sellPrice),
      {
        attempts: EXCHANGE_RETRY_ATTEMPTS,
        delayMs: EXCHANGE_RETRY_DELAY_MS,
        backoffFactor: EXCHANGE_RETRY_BACKOFF,
        onRetry: (error, attempt) => {
          circuitBreaker.recordApiError('create_sell_order');
          logger.warn('create_sell_order_retry', {
            event: 'create_sell_order_retry',
            runId: context.plan.runId,
            pair: context.pair,
            correlationId,
            attempt,
            error: errorMessage(error),
          });
        },
      }
    );
  } catch (err) {
    logger.error('tp_order_failed', {
      event: 'tp_order_failed',
      runId: context.plan.runId,
      pair: context.pair,
      correlationId,
      price: sellPrice,
      amount: sellAmount,
      error: errorMessage(err),
    });
    circuitBreaker.recordApiError('create_sell_order');
    context.metrics!.sellCancels += 1;
    orderCancelCounter.labels(context.clientId, 'sell').inc();
    return;
  }
  await context.sendNotification?.(`Placed SELL TP ${context.pair} ${sellAmount}@${sellPrice} id:${sellOrder.id}`);
  const dbSellOrder = await context.ordersRepo.insertOrder({
    runId: context.plan.runId,
    exchangeOrderId: sellOrder.id,
    pair: context.pair,
    side: 'sell',
    price: sellPrice,
    amount: sellAmount,
    status: 'placed',
    correlationId: `${correlationId}-tp`,
    raw: sellOrder as any,
  });

  appendCsv({
    timestamp: timestampProvider(),
    pair: context.pair,
    side: 'sell',
    price: sellPrice,
    amount: sellAmount,
    status: 'placed',
    note: `tp_for=${correlationId}`,
    runId: context.plan.runId,
    correlationId: `${correlationId}-tp`,
  });

  logger.info('tp_order_placed', {
    event: 'tp_order_placed',
    runId: context.plan.runId,
    pair: context.pair,
    correlationId,
    amount: sellAmount,
    price: sellPrice,
    orderId: sellOrder.id,
  });

  const monitorPromise = monitorSellOrder({
    context,
    order: sellOrder,
    dbOrderId: dbSellOrder.id,
    correlationId: `${correlationId}-tp`,
    targetAmount: sellAmount,
    initialPrice: sellPrice,
    filledSoFar: 0,
  });
  context.pendingTpPromises!.push(monitorPromise);
}

async function monitorSellOrder(params: {
  context: OrderExecutionContext;
  order: ExchangeOrder;
  dbOrderId: number;
  correlationId: string;
  targetAmount: number;
  initialPrice: number;
  filledSoFar?: number;
}) {
  const { context, order, dbOrderId, correlationId, targetAmount, initialPrice, filledSoFar = 0 } = params;
  const pollInterval = Number(process.env.ORDER_POLL_INTERVAL_MS || ORDER_POLL_INTERVAL_MS);
  const replaceTimeoutMs = Number(process.env.REPLACE_TIMEOUT_MS || DEFAULT_REPLACE_TIMEOUT_MS);
  const replaceSlippagePct = Number(process.env.REPLACE_SLIPPAGE_PCT || DEFAULT_REPLACE_SLIPPAGE_PCT);
  const replaceMaxRetries = Number(process.env.REPLACE_MAX_RETRIES || DEFAULT_REPLACE_MAX_RETRIES);

  let currentOrder: ExchangeOrder = order;
  let currentDbOrderId = dbOrderId;
  let lastReportedFilled = filledSoFar;
  let totalFilled = filledSoFar;
  let attempt = 0;
  let orderStart = Date.now();

  const notify = context.sendNotification
    ? context.sendNotification
    : async (msg: string) => {
      await Telegram.sendMessage(msg);
      };

  while (totalFilled < targetAmount - context.marketMeta.stepSize / 2) {
    await sleep(pollInterval);
    if (killSwitch.isActive()) {
      context.metrics!.sellCancels += 1;
      orderCancelCounter.labels(context.clientId, 'sell').inc();
      const currentOrderId = currentOrder.id;
      if (currentOrderId) {
        await retry(
          () => context.exchange.cancelOrder(currentOrderId, context.pair),
          {
            attempts: EXCHANGE_RETRY_ATTEMPTS,
            delayMs: EXCHANGE_RETRY_DELAY_MS,
            backoffFactor: EXCHANGE_RETRY_BACKOFF,
            onRetry: (error, attempt) => {
              circuitBreaker.recordApiError('cancel_order');
              logger.warn('cancel_order_retry', {
                event: 'cancel_order_retry',
                runId: context.plan.runId,
                pair: context.pair,
                orderId: currentOrderId,
                attempt,
                error: errorMessage(error),
              });
            },
          }
        ).catch((error) => {
          logger.warn('cancel_order_failed', {
            event: 'cancel_order_failed',
            runId: context.plan.runId,
            pair: context.pair,
            orderId: currentOrderId,
            error: errorMessage(error),
          });
        });
      }
      await context.ordersRepo.updateOrder({
        orderId: currentDbOrderId,
        status: 'cancelled',
        driftReason: `kill-switch ${killSwitch.getReason()}`,
        filledAmount: totalFilled,
        remainingAmount: Math.max(targetAmount - totalFilled, 0),
      });
      orderLatency.labels(context.clientId, 'sell').observe(Date.now() - orderStart);
      return;
    }

    const currentOrderId = currentOrder.id;
    if (!currentOrderId) {
      logger.warn('tp_order_missing_id', {
        event: 'tp_order_missing_id',
        runId: context.plan.runId,
        pair: context.pair,
        correlationId,
      });
      break;
    }

    let updated: ExchangeOrder;
    try {
      updated = await retry<ExchangeOrder>(
        () => context.exchange.fetchOrder(currentOrderId, context.pair),
        {
          attempts: EXCHANGE_RETRY_ATTEMPTS,
          delayMs: EXCHANGE_RETRY_DELAY_MS,
          backoffFactor: EXCHANGE_RETRY_BACKOFF,
          onRetry: (error, attempt) => {
            circuitBreaker.recordApiError('tp_fetch');
            logger.warn('tp_fetch_retry', {
              event: 'tp_fetch_retry',
              runId: context.plan.runId,
              pair: context.pair,
              correlationId,
              orderId: currentOrderId,
              attempt,
              error: errorMessage(error),
            });
          },
        }
      );
    } catch (err) {
      logger.warn('tp_fetch_failed', {
        event: 'tp_fetch_failed',
        runId: context.plan.runId,
        pair: context.pair,
        correlationId,
        orderId: currentOrderId,
        error: errorMessage(err),
      });
      await context.ordersRepo.updateOrder({
        orderId: currentDbOrderId,
        status: 'placed',
        driftReason: errorMessage(err),
      });
      circuitBreaker.recordApiError('tp_fetch');
      continue;
    }

    const filled = Number(updated.filled ?? 0);
    const delta = Math.max(0, filled - lastReportedFilled);
    if (delta > 0) {
      totalFilled += delta;
      lastReportedFilled = filled;
      await context.ordersRepo.updateOrder({
        orderId: currentDbOrderId,
        status: filled >= targetAmount ? 'closed' : 'partial',
        filledAmount: filled,
        remainingAmount: Math.max(targetAmount - filled, 0),
        raw: updated as any,
      });
      await context.fillsRepo.insertFill({
        orderId: currentDbOrderId,
        runId: context.plan.runId,
        pair: context.pair,
        price: updated.average ?? updated.price ?? initialPrice,
        amount: delta,
        side: 'sell',
        fillTimestamp: updated.timestamp ? new Date(updated.timestamp) : new Date(),
        raw: updated as any,
      });
      fillCounter.labels(context.clientId, 'sell').inc(delta);
      circuitBreaker.recordFill('sell', updated.average ?? updated.price ?? initialPrice, delta, updated.fee?.cost ?? 0);
      logger.info('tp_fill_delta', {
        event: 'tp_fill_delta',
        runId: context.plan.runId,
        pair: context.pair,
        correlationId,
        delta,
        totalFilled,
      });
    }

    const remaining = Math.max(targetAmount - totalFilled, 0);
    const statusLower = (updated.status || '').toLowerCase();
    const isClosed = statusLower === 'closed' || statusLower === 'filled';

    if (remaining <= context.marketMeta.stepSize / 2 || isClosed) {
      await context.ordersRepo.updateOrder({
        orderId: currentDbOrderId,
        status: 'closed',
        filledAmount: totalFilled,
        remainingAmount: 0,
        raw: updated as any,
      });
      await notify(`TP filled ${context.pair} ${totalFilled}@${updated.average ?? updated.price ?? initialPrice} (order ${currentOrderId})`);
      orderLatency.labels(context.clientId, 'sell').observe(Date.now() - orderStart);
      return;
    }

    const elapsed = Date.now() - orderStart;
    const referencePrice = Number(updated.price ?? initialPrice);
    const priceDelta = Math.abs(referencePrice - initialPrice) / (initialPrice || 1);
    const needsReplacement = elapsed > replaceTimeoutMs || priceDelta > replaceSlippagePct;

    if (needsReplacement && attempt < replaceMaxRetries) {
      await context.exchange.cancelOrder(currentOrderId, context.pair).catch((error) => {
        logger.warn('cancel_order_failed', {
          event: 'cancel_order_failed',
          runId: context.plan.runId,
          pair: context.pair,
          orderId: currentOrderId,
          error: errorMessage(error),
        });
      });
      context.metrics!.sellReplacements += 1;
      orderReplacementCounter.labels(context.clientId, 'sell').inc();
      await context.ordersRepo.updateOrder({
        orderId: currentDbOrderId,
        status: 'cancelled',
        filledAmount: totalFilled,
        remainingAmount: remaining,
        driftReason: elapsed > replaceTimeoutMs ? 'timeout' : `price-drift ${priceDelta.toFixed(4)}`,
        raw: updated as any,
      });

      const ticker = await retry<ExchangeTickerWithMeta>(
        () => context.fetchTicker(),
        {
          attempts: EXCHANGE_RETRY_ATTEMPTS,
          delayMs: EXCHANGE_RETRY_DELAY_MS,
          backoffFactor: EXCHANGE_RETRY_BACKOFF,
          onRetry: (error, attempt) => {
            circuitBreaker.recordApiError('fetch_ticker');
            logger.warn('fetch_ticker_retry', {
              event: 'fetch_ticker_retry',
              runId: context.plan.runId,
              pair: context.pair,
              attempt,
              error: errorMessage(error),
            });
          },
        }
      );
      circuitBreaker.recordTicker({
        timestamp: ticker.timestamp ?? Date.now(),
        source: ticker.source ?? null,
        latencyMs: ticker.latencyMs ?? null,
        symbol: context.pair,
      });
      circuitBreaker.checkStaleData();
      const basePriceCandidate = typeof ticker.ask === 'number'
        ? ticker.ask
        : typeof ticker.last === 'number'
          ? ticker.last
          : referencePrice;
      const basePrice = basePriceCandidate || referencePrice;
      const nextPrice = Number((basePrice * (1 - replaceSlippagePct / 2)).toFixed(8));

      logger.warn('tp_order_replaced', {
        event: 'tp_order_replaced',
        runId: context.plan.runId,
        pair: context.pair,
        correlationId,
        orderId: currentOrderId,
        remaining,
        nextPrice,
      });

      await context.limiter!.wait();
      let newOrder;
      try {
        newOrder = await retry<ExchangeOrder>(
          () => context.exchange.createLimitSellOrder(context.pair, remaining, nextPrice),
          {
            attempts: EXCHANGE_RETRY_ATTEMPTS,
            delayMs: EXCHANGE_RETRY_DELAY_MS,
            backoffFactor: EXCHANGE_RETRY_BACKOFF,
            onRetry: (error, retryAttempt) => {
              circuitBreaker.recordApiError('create_sell_order');
              logger.warn('create_sell_order_retry', {
                event: 'create_sell_order_retry',
                runId: context.plan.runId,
                pair: context.pair,
                correlationId,
                attempt: retryAttempt,
                error: errorMessage(error),
              });
            },
          }
        );
      } catch (err) {
        circuitBreaker.recordApiError('create_sell_order');
        logger.error('tp_replace_failed', {
          event: 'tp_replace_failed',
          runId: context.plan.runId,
          pair: context.pair,
          correlationId,
          price: nextPrice,
          amount: remaining,
          error: errorMessage(err),
        });
        context.metrics!.sellCancels += 1;
        orderCancelCounter.labels(context.clientId, 'sell').inc();
        orderLatency.labels(context.clientId, 'sell').observe(Date.now() - orderStart);
        return;
      }
      const newOrderId = newOrder.id ?? 'unknown';
      await context.sendNotification?.(`Replaced TP ${context.pair} ${remaining}@${nextPrice} id:${newOrderId}`);
      const newDbOrder = await context.ordersRepo.insertOrder({
        runId: context.plan.runId,
        exchangeOrderId: newOrder.id,
        pair: context.pair,
        side: 'sell',
        price: nextPrice,
        amount: remaining,
        status: 'placed',
        correlationId,
        raw: newOrder as any,
      });

      currentOrder = { ...newOrder };
      currentDbOrderId = newDbOrder.id;
      lastReportedFilled = 0;
      orderStart = Date.now();
      attempt += 1;
      continue;
    }

    if (needsReplacement && attempt >= replaceMaxRetries) {
      context.metrics!.sellCancels += 1;
      orderCancelCounter.labels(context.clientId, 'sell').inc();
      const currentOrderId = currentOrder.id;
      if (currentOrderId) {
        await context.exchange.cancelOrder(currentOrderId, context.pair).catch((error) => {
          logger.warn('cancel_order_failed', {
            event: 'cancel_order_failed',
            runId: context.plan.runId,
            pair: context.pair,
            orderId: currentOrderId,
            error: errorMessage(error),
          });
        });
      }
      await context.ordersRepo.updateOrder({
        orderId: currentDbOrderId,
        status: 'cancelled',
        driftReason: 'max-retries-exceeded',
        filledAmount: totalFilled,
        remainingAmount: remaining,
        raw: updated as any,
      });
      logger.warn('tp_order_abandoned', {
        event: 'tp_order_abandoned',
        runId: context.plan.runId,
        pair: context.pair,
        correlationId,
        remaining,
        orderId: currentOrderId ?? 'unknown',
      });
      orderLatency.labels(context.clientId, 'sell').observe(Date.now() - orderStart);
      return;
    }
  }
}

/**
 * summarizePlanned
 * - Accepts the planned buy levels and perTradeUsd and returns + prints
 *   a concise planned summary object (and returns it for programmatic use).
 */
export function summarizePlanned(
  pair: string,
  buyLevels: { price: number; amount: number }[],
  perTradeUsd: number,
  exFeePct: number | undefined
) {
  const feePct = typeof exFeePct === 'number' && isFinite(exFeePct) ? exFeePct : FALLBACK_FEE_PCT;

  const numBuys = buyLevels.length;
  const totalBtc = buyLevels.reduce((s, b) => s + b.amount, 0);
  const entryUsd = buyLevels.reduce((s, b) => s + b.price * b.amount, 0);
  // estimate TP price per buy using provided TAKE_PROFIT_PCT if present, otherwise use a safe default (2%)
  const defaultTpPct = Number(process.env.TP) || Number(process.env.TAKE_PROFIT_PCT) || 0.02;
  const estTpUsd = buyLevels.reduce((s, b) => s + b.amount * b.price * (1 + defaultTpPct), 0);

  const totalFees = (entryUsd + estTpUsd) * feePct; // buy fee + sell fee approx
  const estNetProfit = estTpUsd - entryUsd - totalFees;
  const estNetReturnPct = entryUsd > 0 ? (estNetProfit / entryUsd) * 100 : 0;

  const summary = {
    pair,
    numBuys,
    totalBtc: totalBtc.toFixed(8),
    entryUsd: entryUsd.toFixed(6),
    estTpUsd: estTpUsd.toFixed(6),
    totalFees: totalFees.toFixed(6),
    estNetProfit: estNetProfit.toFixed(6),
    estNetReturnPct: estNetReturnPct.toFixed(4) + '%',
    raw: {
      totalBtc,
      entryUsd,
      estTpUsd,
      totalFees,
      estNetProfit,
      estNetReturnPct,
      perTradeUsd,
      feePct,
    },
  };
  return summary;
}

/**
 * Helper: retrieve stepSize (base precision) and minNotional (if any) from market metadata.
 * Returns { stepSize: number, basePrecisionDecimals: number, minNotional: number | null }
 */
export function getMarketStepAndMinNotional(ex: any, pair: string) {
  const market: any = ex && ex.markets && ex.markets[pair] ? ex.markets[pair] : null;
  let stepSize = 1e-8;
  let basePrecision = 8;
  let minNotional: number | null = null;

  if (market) {
    // precision.base may be an integer (number of decimals)
    if (market.precision && typeof market.precision.base === 'number') {
      basePrecision = market.precision.base;
      stepSize = Math.pow(10, -basePrecision);
    } else if (market.info && market.info.baseAssetPrecision != null) {
      basePrecision = Number(market.info.baseAssetPrecision);
      if (!Number.isNaN(basePrecision)) stepSize = Math.pow(10, -basePrecision);
    }

    // first try ccxt standard limits
    if (market.limits && market.limits.cost && typeof market.limits.cost.min === 'number') {
      minNotional = market.limits.cost.min;
    } else if (market.limits && market.limits.amount && typeof market.limits.amount.min === 'number') {
      // sometimes exchanges express min amount not cost
      minNotional = null; // we can't derive USD cost without price; leave null
    }

    // fallback: inspect market.info.filters for exchange-specific fields (e.g. Binance minNotional)
    if ((minNotional === null || minNotional === undefined) && market.info && Array.isArray(market.info.filters)) {
      for (const f of market.info.filters) {
        if (f && (f.minNotional || f.minNotionalUsd || f.minNotionalAmount)) {
          // try several field names
          const cand = Number(f.minNotional || f.minNotionalUsd || f.minNotionalAmount);
          if (!Number.isNaN(cand) && cand > 0) {
            minNotional = cand;
            break;
          }
        }
        // some exchanges expose 'minQty' and 'minNotional' pair
        if (f && f.minNotional) {
          const cand = Number(f.minNotional);
          if (!Number.isNaN(cand) && cand > 0) {
            minNotional = cand;
            break;
          }
        }
      }
    }
  }

  return { stepSize, basePrecision, minNotional };
}

/**
 * Ensure perTradeUsd and final amount respect exchange step and min notional.
 * Returns adjustedPerTradeUsd and final amount to use.
 */
export function adjustPerTradeToExchange(
  perTradeUsd: number,
  price: number,
  stepSize: number,
  basePrecision: number,
  minNotional: number | null
): { perTradeUsd: number; amount: number; adjusted: boolean; reason?: string } {
  if (!Number.isFinite(perTradeUsd) || perTradeUsd <= 0) {
    return { perTradeUsd, amount: 0, adjusted: true, reason: 'invalid-perTradeUsd' };
  }
  // compute raw amount
  let rawAmount = perTradeUsd / price;
  // compute units based on stepSize
  const units = Math.floor(rawAmount / stepSize);
  let adjusted = false;
  let reason: string | undefined;

  if (units < 1) {
    // not enough to buy even a single step unit -> bump to one step unit
    const amount = Number(stepSize.toFixed(basePrecision));
    const newPerTradeUsd = amount * price;
    adjusted = true;
    reason = `amount<stepSize, bumped to 1 unit`;
    // if minNotional exists and this newPerTradeUsd < minNotional, then we must bump to minNotional
    if (minNotional && newPerTradeUsd < minNotional) {
      // If price is super large such that even one unit is below minNotional (unlikely), set perTrade to minNotional and recompute units
      const amountFromMin = Math.floor((minNotional / price) / stepSize) || 1;
      const finalAmount = Number((amountFromMin * stepSize).toFixed(basePrecision));
      const finalPerTrade = finalAmount * price;
      return { perTradeUsd: finalPerTrade, amount: finalAmount, adjusted: true, reason: `bumped to meet minNotional` };
    }
    return { perTradeUsd: newPerTradeUsd, amount, adjusted, reason };
  }

  // normal case: round down to nearest allowed units
  const finalUnits = units;
  const finalAmount = Number((finalUnits * stepSize).toFixed(basePrecision));
  let finalPerTradeUsd = finalAmount * price;

  // if minNotional defined and finalPerTradeUsd < minNotional, try to increase units
  if (minNotional && finalPerTradeUsd < minNotional) {
    const needUnits = Math.ceil((minNotional / price) / stepSize);
    const adjustedUnits = Math.max(needUnits, finalUnits);
    const adjustedAmount = Number((adjustedUnits * stepSize).toFixed(basePrecision));
    finalPerTradeUsd = adjustedAmount * price;
    adjusted = true;
    reason = `increased units to satisfy minNotional`;
    return { perTradeUsd: finalPerTradeUsd, amount: adjustedAmount, adjusted: true, reason };
  }

  return { perTradeUsd: finalPerTradeUsd, amount: finalAmount, adjusted, reason };
}

/**
 * runGridOnce:
 * - Builds buy levels according to env params or fallback defaults
 * - Prints planned summary (and if SUMMARY_ONLY=true will exit afterwards)
 * - If PAPER_MODE: simulates fills and TPs and logs to CSV
 * - If LIVE: attempts to place limit buys, polls until fill or timeout, then places TP
 */
export interface RunGridOptions {
  clientId?: string;
  runMode?: 'summary' | 'paper' | 'live';
  summaryOnly?: boolean;
  actor?: string;
  configOverrides?: Record<string, unknown>;
}

export async function runGridOnce(
  pair: string,
  apiKey?: string,
  apiSecret?: string,
  options: RunGridOptions = {}
): Promise<GridPlan | void> {
  const pool = getPool();
  await runMigrations(pool);
  const clientId = options.clientId ?? CONFIG.RUN.CLIENT_ID;
  const adminOverrideIds = (process.env.ADMIN_LIVE_OVERRIDE_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  const bypassPlanRestrictions = adminOverrideIds.includes(clientId);
  const clientConfigService = new ClientConfigService(pool, {
    allowedClientId: clientId,
    defaultExchange: CONFIG.DEFAULT_EXCHANGE,
  });
  setLogContext({ clientId, actor: options.actor });
  const clientProfile = await clientConfigService.getClientProfile(clientId);
  const overrides = options.configOverrides ?? {};
  const allocationUsdOverride =
    typeof overrides.portfolioAllocationUsd === 'number' && Number.isFinite(overrides.portfolioAllocationUsd)
      ? Number(overrides.portfolioAllocationUsd)
      : null;
  const portfolioWeightPctOverride =
    typeof overrides.portfolioWeightPct === 'number' && Number.isFinite(overrides.portfolioWeightPct)
      ? Number(overrides.portfolioWeightPct)
      : null;
  const summaryOnly = options.summaryOnly ?? (process.env.SUMMARY_ONLY || '').toLowerCase() === 'true';
  const runMode: GridPlan['runMode'] =
    options.runMode ?? (summaryOnly ? 'summary' : CONFIG.PAPER_MODE ? 'paper' : 'live');
  circuitBreaker.configureForClient(clientProfile.guard, clientId);
  const baseOrderRateInterval = Math.max(0, Number(process.env.ORDER_RATE_INTERVAL_MS || DEFAULT_ORDER_RATE_INTERVAL_MS));
  const sharedLimiter = getClientRateLimiter(clientId, baseOrderRateInterval);
  const streamingMonitorEnabled =
    CONFIG.STREAMING.ENABLED && (clientProfile.exchangeId || '').toLowerCase() === 'binance';
  const intelligenceEnabled = (process.env.ENABLE_MARKET_INTELLIGENCE || 'true').toLowerCase() === 'true';
  let intelligenceEngine: MarketIntelligenceEngine | null = null;
  let intelligenceSummary: IntelligenceSummary | null = null;
  let takeProfitOverride: number | null = null;
  let performanceMetrics: RecentPerformanceMetrics | null = null;
  let riskSummary: RiskEvaluationResult | null = null;
  let riskEngine: RiskEngine | null = null;
  const detachTickerListener = streamingMonitorEnabled
    ? binanceStreamingGateway.onTicker(pair, (snapshot) => {
        const latencyMs = snapshot.source === 'ws' ? Date.now() - snapshot.receivedAt : null;
        circuitBreaker.recordTicker({
          timestamp: snapshot.eventTime,
          source: snapshot.source,
          latencyMs,
          symbol: pair,
        });
      })
    : null;
  let lastLimiterInterval = sharedLimiter.getIntervalMs();
  const adjustLimiterForHealth = (maybeHealth?: StreamingSymbolHealth) => {
    if (!streamingMonitorEnabled) return;
    const health = maybeHealth ?? binanceStreamingGateway.getSymbolHealth(pair);
    let targetInterval = Math.max(baseOrderRateInterval, 80);
    switch (health.status) {
      case 'healthy': {
        if (health.avgLatencyMs !== null && health.avgLatencyMs < 150) {
          targetInterval = Math.max(50, Math.round(baseOrderRateInterval * 0.6));
        } else {
          targetInterval = Math.max(80, Math.round(baseOrderRateInterval * 0.8));
        }
        break;
      }
      case 'degraded': {
        const degradeBase = Math.max(baseOrderRateInterval, 150);
        targetInterval = Math.round(degradeBase * 1.15);
        break;
      }
      case 'stale':
      case 'disconnected': {
        const staleThreshold = Math.max(CONFIG.STREAMING.STALE_TICKER_MS, baseOrderRateInterval || 1);
        targetInterval = Math.max(staleThreshold, baseOrderRateInterval);
        break;
      }
      default:
        targetInterval = baseOrderRateInterval;
    }
    if (targetInterval !== lastLimiterInterval) {
      sharedLimiter.updateInterval(targetInterval);
      lastLimiterInterval = targetInterval;
      logger.debug('order_rate_interval_adjusted', {
        event: 'order_rate_interval_adjusted',
        pair,
        clientId,
        status: health.status,
        targetInterval,
        avgLatencyMs: health.avgLatencyMs ?? undefined,
      });
    }
  };
  const detachHealthListener = streamingMonitorEnabled
    ? binanceStreamingGateway.onSymbolHealth(pair, adjustLimiterForHealth)
    : null;
  if (streamingMonitorEnabled) {
    adjustLimiterForHealth(binanceStreamingGateway.getSymbolHealth(pair));
  }
  const operations = clientProfile.operations;
  if (!bypassPlanRestrictions) {
    if (runMode === 'live' && operations.paperOnly) {
      logger.warn('live_blocked_paper_plan', {
        event: 'live_blocked_paper_plan',
        clientId,
        pair,
      });
      throw new Error(`Client ${clientId} is limited to paper trading by plan`);
    }
    if (runMode === 'live' && operations.allowLiveTrading === false) {
      logger.warn('live_blocked_plan_limit', {
        event: 'live_blocked_plan_limit',
        clientId,
        pair,
      });
      throw new Error(`Live trading is disabled for client ${clientId}`);
    }
    if (operations.allowedExchanges && operations.allowedExchanges.length > 0) {
      if (!operations.allowedExchanges.includes(clientProfile.exchangeId)) {
        logger.warn('exchange_not_permitted', {
          event: 'exchange_not_permitted',
          clientId,
          exchangeId: clientProfile.exchangeId,
          allowedExchanges: operations.allowedExchanges,
        });
        throw new Error(`Exchange ${clientProfile.exchangeId} is not permitted for client ${clientId}`);
      }
    }
    if (operations.allowedSymbols && !operations.allowedSymbols.includes(pair)) {
      throw new Error(`Pair ${pair} is not permitted for client ${clientId}`);
    }
  } else {
    logger.debug('admin_plan_override', {
      event: 'admin_plan_override',
      clientId,
      pair,
      runMode,
    });
  }
  let effectiveApiKey = apiKey;
  let effectiveApiSecret = apiSecret;
  let effectivePassphrase: string | null | undefined = undefined;

  if (!effectiveApiKey || !effectiveApiSecret) {
    try {
      const fullConfig = await clientConfigService.getClientConfig(clientId, clientProfile.exchangeId);
      effectiveApiKey = fullConfig.exchange.apiKey;
      effectiveApiSecret = fullConfig.exchange.apiSecret;
      effectivePassphrase = fullConfig.exchange.passphrase;
    } catch (err) {
      if (!CONFIG.PAPER_MODE && (process.env.SUMMARY_ONLY || '').toLowerCase() !== 'true') {
        throw err;
      }
      logger.warn('client_credentials_missing', {
        event: 'client_credentials_missing',
        clientId,
        exchangeId: clientProfile.exchangeId,
        mode: CONFIG.PAPER_MODE ? 'paper' : 'live',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const runsRepo = new RunsRepository(pool, clientId);
  const ordersRepo = new OrdersRepository(pool, clientId);
  const fillsRepo = new FillsRepository(pool, clientId);
  const inventoryRepo = new InventoryRepository(pool, clientId);
  const guardRepo = new GuardStateRepository(pool, clientId);
  const ex = getExchange({
    exchangeId: clientProfile.exchangeId,
    apiKey: effectiveApiKey,
    apiSecret: effectiveApiSecret,
    passphrase: effectivePassphrase,
  });
  const timestampProvider = createTimestampProvider(runMode !== 'live');

  await circuitBreaker.initialize(guardRepo);
  await circuitBreaker.resetRun();
  if (killSwitch.isActive()) {
    throw new Error(`Kill switch active: ${killSwitch.getReason()}`);
  }

  await reconcileOpenOrders(pool, { orders: ordersRepo, runs: runsRepo, fills: fillsRepo }, ex as any, clientId);

  const realtimeTickerFetcher = () =>
    getRealtimeTicker({
      exchangeId: clientProfile.exchangeId,
      pair,
      fallback: () => ex.fetchTicker(pair),
    }) as Promise<ExchangeTickerWithMeta>;

  const ticker = await retry<ExchangeTickerWithMeta>(realtimeTickerFetcher, {
    attempts: EXCHANGE_RETRY_ATTEMPTS,
    delayMs: EXCHANGE_RETRY_DELAY_MS,
    backoffFactor: EXCHANGE_RETRY_BACKOFF,
    onRetry: (error, attempt) => {
      circuitBreaker.recordApiError('fetch_ticker');
      logger.warn('fetch_ticker_retry', {
        event: 'fetch_ticker_retry',
        pair,
        attempt,
        error: errorMessage(error),
      });
    },
  });
  const fallbackPrice = typeof ticker.last === 'number' ? ticker.last : 0;
  const bidPrice = typeof ticker.bid === 'number' ? ticker.bid : fallbackPrice;
  const askPrice = typeof ticker.ask === 'number' ? ticker.ask : (fallbackPrice || bidPrice);
  const mid = (bidPrice + askPrice) / 2;
  const tickerBid = bidPrice;
  const tickerAsk = askPrice;
  circuitBreaker.recordTicker({
    timestamp: ticker.timestamp ?? Date.now(),
    source: ticker.source ?? null,
    latencyMs: ticker.latencyMs ?? null,
    symbol: pair,
  });
  circuitBreaker.checkStaleData();

  const baseGridSteps = Number(process.env.GRID_STEPS) || 8;
  const baseGridSizePct = Number(process.env.GRID_SIZE_PCT) || 0.02;
  const perTradeUsdEnv = process.env.PER_TRADE_USD;
  const perTradePctEnv = process.env.PER_TRADE;
  let bankrollUsd = clientProfile.risk.bankrollUsd;
  if (allocationUsdOverride && allocationUsdOverride > 0) {
    bankrollUsd = Math.min(allocationUsdOverride, bankrollUsd);
  }
  const defaultPerTradePct = clientProfile.risk.maxPerTradePct;
  let perTradeUsdOrig =
    perTradeUsdEnv !== undefined
      ? Number(perTradeUsdEnv)
      : clientProfile.risk.perTradeUsd !== undefined
      ? clientProfile.risk.perTradeUsd
      : perTradePctEnv !== undefined
      ? bankrollUsd * Number(perTradePctEnv)
      : bankrollUsd * defaultPerTradePct;

  if (!riskEngine) {
    const maxPerTradeFromOps = operations.maxPerTradeUsd ?? bankrollUsd * clientProfile.risk.maxPerTradePct;
    riskEngine = new RiskEngine({
      bankrollUsd,
      sectorLimits: sectorLimitConfig,
      correlationLimits: correlationLimitConfig,
      assetToSector: assetSectorMap,
      assetToCorrelationGroup: assetCorrelationMap,
      maxVarUsd: Number(process.env.RISK_MAX_VAR_USD || bankrollUsd * 0.25),
      varConfidence: Number(process.env.RISK_VAR_CONFIDENCE || 0.95),
      stressScenarios: stressScenarioConfig,
      stressMaxFractionOfBankroll: Number(process.env.RISK_STRESS_MAX_FRACTION || 0.2),
      drawdownFractionLimit: Number(process.env.RISK_MAX_DRAWDOWN_FRACTION || 0.25),
      kellyCapFraction: Number(process.env.RISK_KELLY_CAP || 0.18),
      minPerTradeUsd: Math.max(10, bankrollUsd * 0.005),
      maxPerTradeUsd: Math.max(50, maxPerTradeFromOps),
    });
  }

  if (operations.maxPerTradeUsd && perTradeUsdOrig > operations.maxPerTradeUsd) {
    logger.warn('per_trade_limited_by_plan', {
      event: 'per_trade_limited_by_plan',
      clientId,
      workerLimit: operations.maxPerTradeUsd,
      requested: perTradeUsdOrig,
    });
    perTradeUsdOrig = operations.maxPerTradeUsd;
  }

  let adjustedGridSteps = baseGridSteps;
  let adjustedGridSizePct = baseGridSizePct;
  let regimeAnalysis: any = null;

  try {
    const candles = await ex.fetchOHLCV(pair, '1h', undefined, 200);
    const closes = (candles || []).map((c: any) => c[4]);
    let fundingRate: number | null = null;
    if (typeof (ex as any).fetchFundingRate === 'function') {
      try {
        const funding = await (ex as any).fetchFundingRate(pair);
        fundingRate = funding?.info?.fundingRate ?? funding?.fundingRate ?? null;
      } catch (err) {
        logger.warn('funding_rate_fetch_failed', {
          event: 'funding_rate_fetch_failed',
          pair,
          error: errorMessage(err),
        });
      }
    }
    if (intelligenceEnabled) {
      const performanceService = new RecentPerformanceService(pool, clientId);
      performanceMetrics = await performanceService.getRecentPerformance({
        pair,
        maxRuns: Number(process.env.INTELLIGENCE_PERFORMANCE_RUNS || 20),
        lookbackDays: Number(process.env.INTELLIGENCE_PERFORMANCE_LOOKBACK_DAYS || 30),
      });
    }

    if (candles && candles.length > 0 && closes.length > 0) {
      regimeAnalysis = analyzeRegime(candles as any, closes, mid, fundingRate);
      adjustedGridSteps = Math.max(1, Math.round(baseGridSteps * regimeAnalysis.adjustments.gridStepsMultiplier));
      adjustedGridSizePct = baseGridSizePct * regimeAnalysis.adjustments.gridSizeMultiplier;
      perTradeUsdOrig *= regimeAnalysis.adjustments.perTradeMultiplier;
      logger.info('regime_analysis', {
        event: 'regime_analysis',
        pair,
        regime: regimeAnalysis.regime,
        metrics: regimeAnalysis.metrics,
        adjustments: regimeAnalysis.adjustments,
      });
    }

    if (intelligenceEnabled && candles && candles.length >= 60) {
      const minPerTrade = Math.max(25, perTradeUsdOrig * 0.3);
      const maxPerTrade = operations.maxPerTradeUsd
        ? Math.min(operations.maxPerTradeUsd, perTradeUsdOrig * 2.5)
        : perTradeUsdOrig * 2.5;
      intelligenceEngine = new MarketIntelligenceEngine({
        constraints: {
          minGridSteps: Math.max(2, Math.floor(baseGridSteps * 0.5)),
          maxGridSteps: Math.min(80, Math.floor(baseGridSteps * 2)),
          minGridSizePct: Math.max(0.001, baseGridSizePct * 0.5),
          maxGridSizePct: Math.min(0.25, baseGridSizePct * 2.5),
          minTakeProfitPct: 0.004,
          maxTakeProfitPct: 0.25,
          minPerTradeUsd: Math.min(minPerTrade, maxPerTrade),
          maxPerTradeUsd: Math.max(maxPerTrade, minPerTrade),
        },
        newsProvider: cascadingNewsProvider,
        onChainProvider: onChainProviderInstance,
      });

      const microstructure = await collectMicrostructureSnapshots(ex, pair, mid).catch(() => []);
      intelligenceSummary = await intelligenceEngine.generateInsights({
        pair,
        candles: candles as any,
        midPrice: mid,
        baseParameters: {
          gridSteps: adjustedGridSteps,
          gridSizePct: adjustedGridSizePct,
          takeProfitPct: Number(process.env.TP) || Number(process.env.TAKE_PROFIT_PCT) || 0.02,
          perTradeUsd: perTradeUsdOrig,
        },
        windowResults: performanceMetrics?.pnlSeries ?? undefined,
        drawdowns: performanceMetrics?.drawdowns ?? undefined,
        microstructure,
        fundingRates: fundingRate !== null && fundingRate !== undefined ? [fundingRate] : undefined,
      });

      adjustedGridSteps = intelligenceSummary.optimized.gridSteps;
      adjustedGridSizePct = intelligenceSummary.optimized.gridSizePct;
      perTradeUsdOrig = intelligenceSummary.optimized.perTradeUsd;
      takeProfitOverride = intelligenceSummary.optimized.takeProfitPct;

      const performanceSnapshot = performanceMetrics
        ? {
            runsAnalyzed: performanceMetrics.runIds.length,
            avgPnl: performanceMetrics.pnlSeries.length
              ? performanceMetrics.pnlSeries.reduce((s, v) => s + v, 0) / performanceMetrics.pnlSeries.length
              : 0,
            maxDrawdown: performanceMetrics.drawdowns.length
              ? Math.min(...performanceMetrics.drawdowns)
              : 0,
          }
        : null;

      logger.info('market_intelligence_insights', {
        event: 'market_intelligence_insights',
        pair,
        regimeCompositeScore: intelligenceSummary.regime.compositeScore,
        riskStance: intelligenceSummary.regime.suggestedRiskStance,
        predictive: intelligenceSummary.predictive,
        optimized: intelligenceSummary.optimized,
        evolved: intelligenceSummary.evolved,
        score: intelligenceSummary.score,
        performance: performanceSnapshot ?? undefined,
      });

      intelligenceCompositeGauge.labels(clientId, pair).set(intelligenceSummary.regime.compositeScore);
      intelligenceRiskBiasGauge.labels(clientId, pair).set(riskStanceToNumber(intelligenceSummary.regime.suggestedRiskStance));
      intelligenceVolatilityGauge.labels(clientId, pair).set(intelligenceSummary.regime.garchVolatility);
      intelligencePerTradeGauge.labels(clientId, pair).set(intelligenceSummary.optimized.perTradeUsd);
      intelligenceTakeProfitGauge.labels(clientId, pair).set(intelligenceSummary.optimized.takeProfitPct);
    } else if (intelligenceEnabled) {
      intelligenceCompositeGauge.labels(clientId, pair).set(0);
      intelligenceRiskBiasGauge.labels(clientId, pair).set(0);
      intelligenceVolatilityGauge.labels(clientId, pair).set(0);
      intelligencePerTradeGauge.labels(clientId, pair).set(perTradeUsdOrig);
      const tpCandidate = Number(process.env.TP) || Number(process.env.TAKE_PROFIT_PCT) || 0.02;
      intelligenceTakeProfitGauge.labels(clientId, pair).set(tpCandidate);
    }

    const exposures = await inventoryRepo.getLatestSnapshots();
    const plannedExposureEstimate = perTradeUsdOrig * adjustedGridSteps;
    if (!riskEngine) {
      throw new Error('risk_engine_not_initialized');
    }
    const riskDecision = riskEngine.evaluate({
      pair,
      baseAsset: getBaseAssetFromPair(pair),
      plannedExposureUsd: plannedExposureEstimate,
      perTradeUsd: perTradeUsdOrig,
      gridSizePct: adjustedGridSizePct,
      takeProfitPct: takeProfitOverride ?? (Number(process.env.TP) || Number(process.env.TAKE_PROFIT_PCT) || 0.02),
      recentPerformance: performanceMetrics,
      exposures,
      volatility: regimeAnalysis?.metrics?.volatility ?? null,
      garchVolatility: intelligenceSummary?.regime.garchVolatility ?? null,
      currentDrawdownUsd: performanceMetrics && performanceMetrics.drawdowns.length
        ? Math.min(...performanceMetrics.drawdowns)
        : null,
      realizedPnlUsd: performanceMetrics
        ? performanceMetrics.pnlSeries.reduce((sum, v) => sum + v, 0)
        : null,
    });

    riskVaRGauge.labels(clientId, pair).set(riskDecision.valueAtRiskUsd);
    riskStressLossGauge.labels(clientId, pair).set(riskDecision.maxStressLossUsd);
    riskKellyGauge.labels(clientId, pair).set(riskDecision.kellyFraction);
    riskSummary = riskDecision;

    if (!riskDecision.approved) {
      logger.warn('risk_engine_blocked', {
        event: 'risk_engine_blocked',
        pair,
        reason: riskDecision.blockedReason,
        messages: riskDecision.messages,
      });
      throw new Error(riskDecision.blockedReason || 'Risk engine blocked trade');
    }

    perTradeUsdOrig = riskDecision.adjustedPerTradeUsd;
    adjustedGridSizePct = riskDecision.adjustedGridSizePct;
    takeProfitOverride = riskDecision.adjustedTakeProfitPct;

    logger.info('risk_engine_adjustment', {
      event: 'risk_engine_adjustment',
      pair,
      perTradeUsd: perTradeUsdOrig,
      gridSizePct: adjustedGridSizePct,
      takeProfitPct: takeProfitOverride,
      valueAtRiskUsd: riskDecision.valueAtRiskUsd,
      stressLossUsd: riskDecision.maxStressLossUsd,
      messages: riskDecision.messages,
    });
  } catch (err) {
    logger.warn('regime_analysis_failed', {
      event: 'regime_analysis_failed',
      pair,
      error: errorMessage(err),
    });
  }

  let exchangeFeePct: number | undefined = undefined;
  try {
    const feeInfo = (ex as any).fees;
    if (feeInfo && feeInfo.trading && typeof feeInfo.trading.taker === 'number') {
      exchangeFeePct = feeInfo.trading.taker;
    } else if (feeInfo && typeof (feeInfo as any).taker === 'number') {
      exchangeFeePct = (feeInfo as any).taker;
    }
  } catch {
    exchangeFeePct = undefined;
  }

  const { stepSize, basePrecision, minNotional } = getMarketStepAndMinNotional(ex, pair);
  const marketMeta = { stepSize, basePrecision, minNotional };

  const gridSteps = adjustedGridSteps;
  const gridSizePct = adjustedGridSizePct;

  const adjusted = adjustPerTradeToExchange(perTradeUsdOrig, mid, stepSize, basePrecision, minNotional);
  const perTradeAdjustmentLog = adjusted.adjusted
    ? {
        from: perTradeUsdOrig,
        to: adjusted.perTradeUsd,
        amount: adjusted.amount,
        reason: adjusted.reason,
      }
    : null;
  const perTradeUsd = adjusted.perTradeUsd;

  const buyLevels: GridBuyLevel[] = [];
  const skippedLevels: { index: number; price: number; amount: number }[] = [];
  for (let i = 1; i <= gridSteps; i++) {
    const price = mid * (1 - i * gridSizePct);
    const adj = adjustPerTradeToExchange(perTradeUsd, price, stepSize, basePrecision, minNotional);
    if (!adj.amount || adj.amount <= 0) {
      skippedLevels.push({ index: i, price, amount: adj.amount });
      continue;
    }
    buyLevels.push({
      price: Number(price.toFixed(8)),
      amount: adj.amount,
      perTradeUsd: adj.perTradeUsd,
      adjusted: adj.adjusted,
      adjustReason: adj.reason,
    });
  }

  const summary = summarizePlanned(pair, buyLevels, perTradeUsd, exchangeFeePct);
  const feePctToUse = exchangeFeePct ?? FALLBACK_FEE_PCT;
  const runId = generateRunId({
    explicit: process.env.RUN_ID,
    runMode,
    pair,
    gridSteps,
    gridSizePct,
    perTradeUsd,
    feePct: feePctToUse,
    mid,
    buyLevels,
  });
  const buyLevelsWithCorrelation = buyLevels.map((lvl, idx) => ({
    ...lvl,
    correlationId: lvl.correlationId || `${runId}-lvl${String(idx + 1).padStart(2, '0')}`,
  }));
  const generatedAt = timestampProvider();
  const plannedExposureUsd = buyLevelsWithCorrelation.reduce(
    (sum, lvl) => sum + (lvl.perTradeUsd ?? 0),
    0
  );

  const plan: GridPlan = {
    runId,
    runMode,
    pair,
    generatedAt,
    gridSteps,
    gridSizePct,
    perTradeUsd,
    feePct: feePctToUse,
    buyLevels: buyLevelsWithCorrelation,
    summary,
    metadata: {
      mid,
      tickerBid,
      tickerAsk,
      stepSize,
      basePrecision,
      minNotional: minNotional ?? null,
      regime: regimeAnalysis,
      portfolioAllocationUsd: allocationUsdOverride,
      portfolioWeightPct: portfolioWeightPctOverride,
      intelligence: intelligenceSummary,
      risk: riskSummary,
    },
    plannedExposureUsd,
  };

  const activeRunMeta = await runsRepo.getActiveRunMetadata();
  const activePairs = new Set(
    activeRunMeta
      .map((meta) => meta.pair)
      .filter((meta): meta is string => Boolean(meta))
  );
  const pairAlreadyActive = activePairs.has(pair);

  if (operations.maxSymbols && !pairAlreadyActive && activePairs.size >= operations.maxSymbols) {
    logger.warn('max_symbols_limit_hit', {
      event: 'max_symbols_limit_hit',
      clientId,
      limit: operations.maxSymbols,
      activePairs: Array.from(activePairs),
      requestedPair: pair,
    });
    throw new Error(`Max symbol limit (${operations.maxSymbols}) reached for client ${clientId}`);
  }

  const priorExposureUsd = activeRunMeta.reduce(
    (sum, meta) => sum + (Number.isFinite(meta.plannedExposureUsd) ? meta.plannedExposureUsd : 0),
    0
  );
  const projectedExposureUsd = priorExposureUsd + plannedExposureUsd;

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dailyExposureUsd = await runsRepo.getPlannedExposureSince(oneDayAgo);
  const projectedDailyExposureUsd = dailyExposureUsd + plannedExposureUsd;

  if (
    operations.maxExposureUsd !== undefined &&
    operations.maxExposureUsd !== null &&
    projectedExposureUsd > operations.maxExposureUsd
  ) {
    logger.warn('exposure_limit_hit', {
      event: 'exposure_limit_hit',
      clientId,
      limit: operations.maxExposureUsd,
      priorExposureUsd,
      plannedExposureUsd,
      projectedExposureUsd,
    });
    throw new Error(
      `Planned exposure ${projectedExposureUsd.toFixed(2)} exceeds limit ${operations.maxExposureUsd} for client ${clientId}`
    );
  }

  if (
    operations.maxDailyVolumeUsd !== undefined &&
    operations.maxDailyVolumeUsd !== null &&
    projectedDailyExposureUsd > operations.maxDailyVolumeUsd
  ) {
    logger.warn('daily_volume_limit_hit', {
      event: 'daily_volume_limit_hit',
      clientId,
      limit: operations.maxDailyVolumeUsd,
      dailyExposureUsd,
      plannedExposureUsd,
      projectedDailyExposureUsd,
    });
    throw new Error(
      `Daily planned volume ${projectedDailyExposureUsd.toFixed(2)} exceeds limit ${operations.maxDailyVolumeUsd} for client ${clientId}`
    );
  }

  logger.info('operational_limits_ok', {
    event: 'operational_limits_ok',
    clientId,
    pair,
    priorExposureUsd,
    plannedExposureUsd,
    projectedExposureUsd,
    dailyExposureUsd,
    projectedDailyExposureUsd,
    maxSymbols: operations.maxSymbols ?? null,
    maxExposureUsd: operations.maxExposureUsd ?? null,
    maxDailyVolumeUsd: operations.maxDailyVolumeUsd ?? null,
  });

  await runsRepo.createRun({
    runId: plan.runId,
    owner: CONFIG.RUN.OWNER,
    exchange: (ex as any).id ?? CONFIG.DEFAULT_EXCHANGE,
    paramsJson: {
      pair,
      gridSteps,
      gridSizePct,
      perTradeUsd,
      feePct: feePctToUse,
      runMode,
      summary,
      metadata: plan.metadata,
      regime: regimeAnalysis,
      plannedExposureUsd,
      limits: {
        maxExposureUsd: operations.maxExposureUsd ?? null,
        maxSymbols: operations.maxSymbols ?? null,
      },
    },
    rateLimitMeta: captureRateLimitMeta(ex),
    marketSnapshot: captureMarketSnapshot(pair, ticker, marketMeta),
  });

  if (regimeAnalysis) {
    logger.info('regime_applied', {
      event: 'regime_applied',
      runId: plan.runId,
      pair,
      regime: regimeAnalysis.regime,
      adjustments: regimeAnalysis.adjustments,
    });
  }

  const [baseAsset, quoteAsset] = pair.split('/') as [string, string];
  if (baseAsset && quoteAsset) {
    await inventoryRepo.insertSnapshot({
      runId: plan.runId,
      baseAsset,
      quoteAsset,
      exposureUsd: plannedExposureUsd,
      metadata: {
        event: 'run_start',
        mid,
        plannedExposureUsd,
        priorExposureUsd,
        projectedExposureUsd,
        dailyExposureUsd,
        projectedDailyExposureUsd,
        limits: {
          maxExposureUsd: operations.maxExposureUsd ?? null,
          maxSymbols: operations.maxSymbols ?? null,
          maxDailyVolumeUsd: operations.maxDailyVolumeUsd ?? null,
        },
      },
    });
  }

  logger.info('run_plan_ready', {
    event: 'run_plan_ready',
    runId: plan.runId,
    pair,
    runMode: plan.runMode,
    generatedAt: plan.generatedAt,
    gridSteps: plan.gridSteps,
    gridSizePct: plan.gridSizePct,
    perTradeUsd: plan.perTradeUsd,
    feePct: plan.feePct,
    plannedExposureUsd: plan.plannedExposureUsd,
  });
  logger.info('market_metadata_resolved', {
    event: 'market_metadata',
    runId: plan.runId,
    pair,
    stepSize: marketMeta.stepSize,
    basePrecision: marketMeta.basePrecision,
    minNotional: marketMeta.minNotional,
  });
  if (perTradeAdjustmentLog) {
    logger.info('per_trade_adjustment', {
      event: 'per_trade_adjustment',
      runId: plan.runId,
      pair,
      ...perTradeAdjustmentLog,
    });
  }
  for (const skipped of skippedLevels) {
    logger.warn('grid_level_skipped', {
      event: 'grid_level_skipped',
      runId: plan.runId,
      pair,
      level: skipped.index,
      price: skipped.price,
      computedAmount: skipped.amount,
    });
  }
  logger.info('planned_summary', {
    event: 'planned_summary',
    runId: plan.runId,
    pair,
    summary,
  });

  let releaseLock: (() => void) | null = null;
  try {
    if (runMode !== 'summary') {
      releaseLock = acquirePairLock(pair, plan.runId);
    }

    if (summaryOnly) {
      maybeWritePlanJson(plan);
      logger.info('summary_only_exit', {
        event: 'summary_only_exit',
        runId: plan.runId,
        pair,
      });
      await runsRepo.updateStatus({ runId: plan.runId, status: 'completed' });
      return plan;
    }

    const envTakeProfit = Number(process.env.TP) || Number(process.env.TAKE_PROFIT_PCT);
    let takeProfitPct = Number.isFinite(envTakeProfit) && envTakeProfit > 0 ? envTakeProfit : 0.02;
    if (takeProfitOverride !== null) {
      takeProfitPct = takeProfitOverride;
      logger.info('take_profit_override_applied', {
        event: 'take_profit_override_applied',
        runId: plan.runId,
        pair,
        takeProfitPct,
      });
    }
    takeProfitPct = Math.max(0.003, Math.min(0.3, takeProfitPct));

    if (runMode === 'paper') {
      for (const lvl of plan.buyLevels) {
        const cost = lvl.price * lvl.amount;
        const fee = cost * plan.feePct;
        appendCsvRow({
          timestamp: timestampProvider(),
          pair,
          side: 'buy',
          price: lvl.price,
          amount: lvl.amount,
          status: 'planned',
          note: 'Grid buy planned',
          runId: plan.runId,
          correlationId: lvl.correlationId,
        });

        logger.info('paper_buy_simulated', {
          event: 'paper_buy_simulated',
          runId: plan.runId,
          pair,
          correlationId: lvl.correlationId,
          amount: lvl.amount,
          price: lvl.price,
          cost,
          fee,
        });
        appendCsvRow({
          timestamp: timestampProvider(),
          pair,
          side: 'buy',
          price: lvl.price,
          amount: lvl.amount,
          status: 'filled',
          note: 'Simulated fill',
          runId: plan.runId,
          correlationId: lvl.correlationId,
        });

        const sellPrice = Number((lvl.price * (1 + takeProfitPct)).toFixed(8));
        const proceeds = sellPrice * lvl.amount;
        const sellFee = proceeds * plan.feePct;
        logger.info('paper_sell_simulated', {
          event: 'paper_sell_simulated',
          runId: plan.runId,
          pair,
          correlationId: lvl.correlationId,
          amount: lvl.amount,
          price: sellPrice,
          proceeds,
          fee: sellFee,
        });
        appendCsvRow({
          timestamp: timestampProvider(),
          pair,
          side: 'sell',
          price: sellPrice,
          amount: lvl.amount,
          status: 'planned',
          note: 'Simulated TP planned',
          runId: plan.runId,
          correlationId: lvl.correlationId,
        });

        appendCsvRow({
          timestamp: timestampProvider(),
          pair,
          side: 'sell',
          price: sellPrice,
          amount: lvl.amount,
          status: 'filled',
          note: 'Simulated TP filled',
          runId: plan.runId,
          correlationId: lvl.correlationId,
        });

        await Telegram.sendMessage(`[PAPER] BUY ${lvl.amount}@${lvl.price} -> SELL ${lvl.amount}@${sellPrice}`);
        await sleep(200);
      }

    maybeWritePlanJson(plan);
    logger.info('run_complete', {
      event: 'run_complete',
      runId: plan.runId,
      pair,
      mode: plan.runMode,
      csvPath: CSV_PATH,
      clientId,
    });
    await runsRepo.updateStatus({ runId: plan.runId, status: 'completed' });
    return plan;
  }
  const executionContext: OrderExecutionContext = {
    clientId,
    exchange: ex as ExchangeExecution,
    pair,
    plan,
    takeProfitPct,
    marketMeta,
    gridSizePct,
    timestampProvider,
    ordersRepo,
    fillsRepo,
    buyLevels: plan.buyLevels,
    appendCsv: (row) => appendCsvRow(row),
    sendNotification: async (message: string) => {
      await Telegram.sendMessage(message);
    },
    metrics: {
      buyReplacements: 0,
      sellReplacements: 0,
      buyCancels: 0,
      sellCancels: 0,
    },
    pendingTpPromises: [],
    limiter: sharedLimiter,
    fetchTicker: () => realtimeTickerFetcher(),
  };

  const existingSellOrders = await ordersRepo.getOpenOrdersForRun(plan.runId, 'sell');
  for (const existing of existingSellOrders) {
    if (!existing.exchange_order_id) continue;
    executionContext.pendingTpPromises!.push(
      monitorSellOrder({
        context: executionContext,
        order: { id: existing.exchange_order_id },
        dbOrderId: existing.id,
        correlationId: existing.correlation_id || `${plan.runId}-tp-${existing.id}`,
        targetAmount: Number(existing.amount),
        initialPrice: Number(existing.price),
        filledSoFar: Number(existing.filled_amount || 0),
      })
    );
  }

  await executeBuyLevels(executionContext);

  maybeWritePlanJson(plan);
  logger.info('run_complete', {
    event: 'run_complete',
    runId: plan.runId,
    pair,
    mode: plan.runMode,
    csvPath: CSV_PATH,
  });
  await runsRepo.updateStatus({ runId: plan.runId, status: 'completed' });
  return plan;
  } catch (err: any) {
    await runsRepo.updateStatus({ runId: plan.runId, status: 'failed' });
    logger.error('run_failed', {
      event: 'run_failed',
      runId: plan.runId,
      pair,
      error: errorMessage(err),
    });
    throw err;
  } finally {
    if (releaseLock) {
      releaseLock();
    }
    if (detachTickerListener) {
      detachTickerListener();
    }
    if (detachHealthListener) {
      detachHealthListener();
    }
  }
}
