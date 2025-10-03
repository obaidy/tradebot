import { createExchangeAdapter, AdapterFactoryConfig } from '../exchanges/adapterFactory';
import type { ExchangeAdapter, AdapterOrderResponse, ArbitrageOpportunity } from '../exchanges/adapters/types';
import { CrossExchangeArbitrageEngine } from '../arbitrage/arbitrageEngine';
import { logger } from '../utils/logger';
import { getPool, closePool } from '../db/pool';
import { runMigrations } from '../db/migrations';
import { InventoryRepository } from '../db/repositories';
import { RecentPerformanceService } from '../services/performance/recentPerformance';
import { ClientAuditLogRepository } from '../db/auditLogRepo';
import { RiskEngine } from '../risk';
import type { PortfolioExposureEntry, RiskPerformanceMetrics } from '../risk';

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

function parseAdapters(): AdapterFactoryConfig[] {
  const raw = process.env.ARBITRAGE_ADAPTERS;
  if (!raw) {
    return [
      { kind: 'ccxt', id: 'binance' },
      { kind: 'ccxt', id: 'kraken' },
    ];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as AdapterFactoryConfig[];
    }
  } catch (err) {
    logger.warn('arbitrage_adapter_parse_failed', {
      event: 'arbitrage_adapter_parse_failed',
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return [];
}

function parseJsonEnv<T extends JsonValue>(key: string, fallback: T): T {
  const raw = process.env[key];
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch (err) {
    logger.warn('arbitrage_env_parse_failed', {
      event: 'arbitrage_env_parse_failed',
      key,
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback;
  }
}

function numberEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function extractBaseAsset(symbol: string): string {
  const [base] = symbol.split(/[/:_-]/g);
  return base ? base.toUpperCase() : symbol;
}

interface WorkerContext {
  clientId: string;
  adapterMap: Map<string, ExchangeAdapter>;
  inventoryRepo: InventoryRepository;
  performanceService: RecentPerformanceService;
  auditRepo: ClientAuditLogRepository;
  riskEngine: RiskEngine;
  maxLegUsd: number;
}

async function processOpportunity(opportunity: ArbitrageOpportunity, ctx: WorkerContext) {
  try {
    const buyAdapter = ctx.adapterMap.get(opportunity.buyExchange);
    const sellAdapter = ctx.adapterMap.get(opportunity.sellExchange);
    if (!buyAdapter || !sellAdapter) {
      logger.warn('arbitrage_adapter_missing', {
        event: 'arbitrage_adapter_missing',
        opportunity,
      });
      return;
    }

    let exposureRows: Array<{ baseAsset: string; quoteAsset: string; exposureUsd: number }> = [];
    try {
      exposureRows = await ctx.inventoryRepo.getLatestSnapshots();
    } catch (err) {
      logger.warn('arbitrage_exposure_fetch_failed', {
        event: 'arbitrage_exposure_fetch_failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const exposures: PortfolioExposureEntry[] = exposureRows.map((row) => ({
      baseAsset: row.baseAsset,
      quoteAsset: row.quoteAsset,
      exposureUsd: Number(row.exposureUsd ?? 0) || 0,
    }));

    let performance: RiskPerformanceMetrics | null = null;
    try {
      performance = await ctx.performanceService.getRecentPerformance({
        pair: opportunity.symbol,
        maxRuns: 30,
        lookbackDays: 45,
      });
    } catch (err) {
      logger.warn('arbitrage_performance_fetch_failed', {
        event: 'arbitrage_performance_fetch_failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const plannedExposureUsd = Math.min(opportunity.volumeUsd, ctx.maxLegUsd);
    if (!Number.isFinite(plannedExposureUsd) || plannedExposureUsd <= 0) {
      return;
    }

    const spreadPct = Math.max(opportunity.spreadPct, 0);

    const riskResult = ctx.riskEngine.evaluate({
      pair: opportunity.symbol,
      baseAsset: extractBaseAsset(opportunity.symbol),
      plannedExposureUsd,
      perTradeUsd: plannedExposureUsd,
      gridSizePct: Math.max(spreadPct / 2, 0.05),
      takeProfitPct: Math.max(spreadPct, 0.1),
      exposures,
      recentPerformance: performance ?? undefined,
    });

    if (!riskResult.approved || riskResult.adjustedPerTradeUsd <= 0) {
      logger.info('arbitrage_trade_blocked', {
        event: 'arbitrage_trade_blocked',
        clientId: ctx.clientId,
        opportunity,
        blockedReason: riskResult.blockedReason ?? 'risk_not_approved',
        messages: riskResult.messages,
      });
      await ctx.auditRepo.addEntry({
        clientId: ctx.clientId,
        actor: 'arbitrage-worker',
        action: 'arbitrage_trade_blocked',
        metadata: {
          opportunity,
          risk: {
            blockedReason: riskResult.blockedReason ?? null,
            messages: riskResult.messages,
          },
        },
      });
      return;
    }

    const legUsd = Math.min(plannedExposureUsd, riskResult.adjustedPerTradeUsd);
    const quantity = legUsd / opportunity.buyPrice;
    if (!Number.isFinite(quantity) || quantity <= 0) {
      logger.warn('arbitrage_quantity_invalid', {
        event: 'arbitrage_quantity_invalid',
        quantity,
        legUsd,
        opportunity,
      });
      return;
    }

    const buyOrder = await buyAdapter.placeOrder({
      symbol: opportunity.symbol,
      side: 'buy',
      amount: quantity,
      type: 'market',
      clientOrderId: `arb-buy-${Date.now()}`,
    });

    let sellOrder: AdapterOrderResponse;
    try {
      sellOrder = await sellAdapter.placeOrder({
        symbol: opportunity.symbol,
        side: 'sell',
        amount: quantity,
        type: 'market',
        clientOrderId: `arb-sell-${Date.now()}`,
      });
    } catch (err) {
      logger.error('arbitrage_sell_failed', {
        event: 'arbitrage_sell_failed',
        clientId: ctx.clientId,
        opportunity,
        error: err instanceof Error ? err.message : String(err),
      });
      await ctx.auditRepo.addEntry({
        clientId: ctx.clientId,
        actor: 'arbitrage-worker',
        action: 'arbitrage_trade_failed',
        metadata: {
          opportunity,
          legUsd,
          quantity,
          buyOrderId: buyOrder.id,
          error: err instanceof Error ? err.message : String(err),
          stage: 'sell_leg',
        },
      });
      if (buyOrder.status !== 'filled') {
        try {
          await buyAdapter.cancelOrder(buyOrder.id, opportunity.symbol);
        } catch (cancelError) {
          logger.warn('arbitrage_buy_cancel_failed', {
            event: 'arbitrage_buy_cancel_failed',
            orderId: buyOrder.id,
            error: cancelError instanceof Error ? cancelError.message : String(cancelError),
          });
        }
      }
      return;
    }

    logger.info('arbitrage_trade_executed', {
      event: 'arbitrage_trade_executed',
      clientId: ctx.clientId,
      symbol: opportunity.symbol,
      buyExchange: buyAdapter.id,
      sellExchange: sellAdapter.id,
      quantity,
      legUsd,
      spreadPct: opportunity.spreadPct,
      buyOrderId: buyOrder.id,
      sellOrderId: sellOrder.id,
    });

    await ctx.auditRepo.addEntry({
      clientId: ctx.clientId,
      actor: 'arbitrage-worker',
      action: 'arbitrage_trade_executed',
      metadata: {
        opportunity,
        quantity,
        legUsd,
        risk: {
          messages: riskResult.messages,
          valueAtRiskUsd: riskResult.valueAtRiskUsd,
          maxStressLossUsd: riskResult.maxStressLossUsd,
        },
        buyOrderId: buyOrder.id,
        sellOrderId: sellOrder.id,
      },
    });
  } catch (err) {
    logger.error('arbitrage_opportunity_processing_failed', {
      event: 'arbitrage_opportunity_processing_failed',
      opportunity,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function main() {
  const adapterConfigs = parseAdapters();
  if (!adapterConfigs.length) {
    throw new Error('no_arbitrage_adapters_configured');
  }

  const adapters = adapterConfigs.map((config) => createExchangeAdapter(config));
  const adapterMap = new Map(adapters.map((adapter) => [adapter.id, adapter]));

  await Promise.all(
    adapters.map(async (adapter) => {
      await adapter.connect();
    })
  );

  const symbols = (process.env.ARBITRAGE_SYMBOLS || 'BTC/USDT,ETH/USDT')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const minSpreadPct = numberEnv('ARBITRAGE_MIN_SPREAD_PCT', 0.3);
  const maxLegUsd = numberEnv('ARBITRAGE_MAX_LEG_USD', 2000);
  const pollIntervalMs = numberEnv('ARBITRAGE_POLL_INTERVAL_MS', 15_000);

  const pool = getPool();
  await runMigrations(pool);

  const clientId = process.env.CLIENT_ID || 'default';
  const inventoryRepo = new InventoryRepository(pool, clientId);
  const performanceService = new RecentPerformanceService(pool, clientId);
  const auditRepo = new ClientAuditLogRepository(pool);

  const bankrollUsd = numberEnv('BANKROLL_USD', Math.max(maxLegUsd * 5, 10_000));
  const riskEngine = new RiskEngine({
    bankrollUsd,
    sectorLimits: parseJsonEnv('RISK_SECTOR_LIMITS', { general: 0.4 }),
    correlationLimits: parseJsonEnv('RISK_CORRELATION_LIMITS', { general: 0.6 }),
    assetToSector: parseJsonEnv('RISK_ASSET_SECTOR_MAP', {}),
    assetToCorrelationGroup: parseJsonEnv('RISK_ASSET_CORRELATION_MAP', {}),
    maxVarUsd: numberEnv('RISK_MAX_VAR_USD', maxLegUsd * 2),
    varConfidence: numberEnv('RISK_VAR_CONFIDENCE', 0.95),
    stressScenarios: parseJsonEnv('RISK_STRESS_SCENARIOS', [
      { name: 'flash_crash', shockPct: 0.25, maxFractionOfBankroll: 0.15 },
    ]),
    stressMaxFractionOfBankroll: numberEnv('RISK_STRESS_MAX_FRACTION', 0.2),
    drawdownFractionLimit: numberEnv('RISK_MAX_DRAWDOWN_FRACTION', 0.25),
    kellyCapFraction: numberEnv('RISK_KELLY_CAP', 0.18),
    minPerTradeUsd: Math.max(25, bankrollUsd * 0.005),
    maxPerTradeUsd: Math.max(maxLegUsd, bankrollUsd * 0.2),
  });

  const context: WorkerContext = {
    clientId,
    adapterMap,
    inventoryRepo,
    performanceService,
    auditRepo,
    riskEngine,
    maxLegUsd,
  };

  const engine = new CrossExchangeArbitrageEngine(adapters, {
    symbols,
    minSpreadPct,
    maxLegUsd,
    pollIntervalMs,
  });

  let processing = false;

  const handleOpportunities = async (opportunities: ArbitrageOpportunity[]) => {
    if (!opportunities.length || processing) return;
    processing = true;
    try {
      const sorted = [...opportunities].sort((a, b) => b.spreadPct - a.spreadPct);
      for (const opportunity of sorted) {
        await processOpportunity(opportunity, context);
      }
    } finally {
      processing = false;
    }
  };

  try {
    const initial = await engine.scan();
    await handleOpportunities(initial);
  } catch (err) {
    logger.warn('arbitrage_initial_scan_failed', {
      event: 'arbitrage_initial_scan_failed',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  engine.start(handleOpportunities);
  logger.info('arbitrage_worker_started', {
    event: 'arbitrage_worker_started',
    symbols,
    minSpreadPct,
    maxLegUsd,
    pollIntervalMs,
    clientId,
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('arbitrage_worker_shutdown', { event: 'arbitrage_worker_shutdown' });
    engine.stop();
    await Promise.all(
      adapters.map(async (adapter) => {
        try {
          await adapter.disconnect();
        } catch (err) {
          logger.warn('arbitrage_adapter_disconnect_failed', {
            event: 'arbitrage_adapter_disconnect_failed',
            adapter: adapter.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
    );
    try {
      await closePool();
    } catch (err) {
      logger.warn('arbitrage_pool_close_failed', {
        event: 'arbitrage_pool_close_failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  logger.error('arbitrage_worker_error', {
    event: 'arbitrage_worker_error',
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
