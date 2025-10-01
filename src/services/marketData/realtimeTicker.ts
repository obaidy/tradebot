import { CONFIG } from '../../config';
import { logger } from '../../utils/logger';
import { binanceStreamingGateway } from '../streaming/binanceGateway';

export interface RealtimeTicker {
  bid: number | null;
  ask: number | null;
  last: number | null;
  timestamp: number;
  source?: 'ws' | 'rest';
  latencyMs?: number;
}

type FallbackTicker = {
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  timestamp?: number;
};

export interface RealtimeTickerParams {
  exchangeId: string;
  pair: string;
  fallback: () => Promise<FallbackTicker>;
  staleMs?: number;
  waitForSnapshotMs?: number;
}

function now() {
  return Date.now();
}

function averagePrice(bid: number | null, ask: number | null) {
  if (bid !== null && ask !== null) {
    return (bid + ask) / 2;
  }
  if (bid !== null) return bid;
  if (ask !== null) return ask;
  return null;
}

function sanitizeTicker(ticker: FallbackTicker, source: 'ws' | 'rest'): RealtimeTicker {
  const bid = typeof ticker.bid === 'number' && Number.isFinite(ticker.bid) ? Number(ticker.bid) : null;
  const ask = typeof ticker.ask === 'number' && Number.isFinite(ticker.ask) ? Number(ticker.ask) : null;
  const lastCandidate = typeof ticker.last === 'number' && Number.isFinite(ticker.last)
    ? Number(ticker.last)
    : averagePrice(bid, ask);
  const timestamp = typeof ticker.timestamp === 'number' && Number.isFinite(ticker.timestamp)
    ? Number(ticker.timestamp)
    : now();

  return {
    bid,
    ask,
    last: lastCandidate,
    timestamp,
    source,
  };
}

function normalizePair(pair: string) {
  return pair.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

export async function getRealtimeTicker(params: RealtimeTickerParams): Promise<RealtimeTicker> {
  const { exchangeId, pair, fallback } = params;
  const lowerExchange = exchangeId.toLowerCase();

  const useBinanceStream = CONFIG.STREAMING.ENABLED && lowerExchange === 'binance';
  const staleMs = params.staleMs ?? CONFIG.STREAMING.STALE_TICKER_MS;
  const waitForSnapshotMs = params.waitForSnapshotMs ?? CONFIG.STREAMING.WAIT_FOR_SNAPSHOT_MS;

  if (!useBinanceStream) {
    const fallbackTicker = await fallback();
    return sanitizeTicker(fallbackTicker, 'rest');
  }

  binanceStreamingGateway.watchSymbol(pair);
  const symbolKey = normalizePair(pair);
  let snapshot = binanceStreamingGateway.getLatestTicker(symbolKey);

  if ((!snapshot || now() - snapshot.receivedAt > staleMs) && waitForSnapshotMs > 0) {
    snapshot = await binanceStreamingGateway.waitForFreshTicker(symbolKey, waitForSnapshotMs);
  }

  if (snapshot && now() - snapshot.receivedAt <= staleMs) {
    return {
      bid: snapshot.bidPrice,
      ask: snapshot.askPrice,
      last: averagePrice(snapshot.bidPrice, snapshot.askPrice),
      timestamp: snapshot.eventTime,
      source: snapshot.source,
      latencyMs: now() - snapshot.receivedAt,
    };
  }

  logger.debug('realtime_ticker_fallback', {
    event: 'realtime_ticker_fallback',
    exchangeId,
    pair,
  });

  const fallbackTicker = await fallback();
  const normalizedFallback = sanitizeTicker(fallbackTicker, 'rest');
  binanceStreamingGateway.recordRestFallback(pair, normalizedFallback);
  return normalizedFallback;
}
