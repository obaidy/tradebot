import ccxt from 'ccxt';
import { logger } from '../utils/logger';

export interface FundingOpportunity {
  exchange: string;
  symbol: string;
  fundingRate: number;
  nextFundingTimestamp: number | null;
  markPrice: number | null;
  indexPrice: number | null;
  basisBps: number | null;
  info: Record<string, unknown>;
}

export interface FundingFetchOptions {
  exchanges?: string[];
  minAbsFundingRate?: number;
  limit?: number;
}

const DEFAULT_EXCHANGES = (process.env.FUNDING_EXCHANGES ?? 'binance,kucoin,bybit').split(',').map((ex) => ex.trim()).filter(Boolean);

function computeBasisBps(markPrice?: number | null, indexPrice?: number | null): number | null {
  if (!markPrice || !indexPrice) return null;
  if (markPrice <= 0 || indexPrice <= 0) return null;
  const basis = ((markPrice - indexPrice) / indexPrice) * 10_000;
  return Number.isFinite(basis) ? basis : null;
}

async function loadFundingForExchange(exchangeId: string): Promise<FundingOpportunity[]> {
  const ExchangeClass = (ccxt as any)[exchangeId];
  if (!ExchangeClass) {
    logger.warn('funding_exchange_unsupported', {
      event: 'funding_exchange_unsupported',
      exchangeId,
    });
    return [];
  }
  const exchange = new ExchangeClass({
    enableRateLimit: true,
    options: { adjustForTimeDifference: true },
  });
  if (!exchange.has.fetchFundingRates) {
    logger.warn('funding_fetch_not_supported', {
      event: 'funding_fetch_not_supported',
      exchangeId,
    });
    return [];
  }
  try {
    const rates = await exchange.fetchFundingRates();
    return Object.entries(rates).map(([symbol, payload]: [string, any]) => {
      const fundingRate = Number(payload.fundingRate ?? payload.fundingRatePercentage ?? 0);
      const markPrice = Number(payload.markPrice ?? payload.info?.markPrice ?? payload.info?.fairPrice ?? payload.last);
      const indexPrice = Number(payload.indexPrice ?? payload.info?.indexPrice ?? payload.index);
      let nextFundingTimestamp: number | null = null;
      if (payload.nextFundingTimestamp) {
        const ts = Number(payload.nextFundingTimestamp);
        nextFundingTimestamp = Number.isFinite(ts) ? ts : null;
      } else if (payload.nextFundingDatetime) {
        const parsed = new Date(payload.nextFundingDatetime).valueOf();
        nextFundingTimestamp = Number.isFinite(parsed) ? parsed : null;
      }
      return {
        exchange: exchangeId,
        symbol,
        fundingRate,
        nextFundingTimestamp,
        markPrice: Number.isFinite(markPrice) ? markPrice : null,
        indexPrice: Number.isFinite(indexPrice) ? indexPrice : null,
        basisBps: computeBasisBps(markPrice, indexPrice),
        info: payload,
      };
    });
  } catch (error) {
    logger.warn('funding_fetch_failed', {
      event: 'funding_fetch_failed',
      exchangeId,
      message: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function fetchFundingOpportunities(options: FundingFetchOptions = {}): Promise<FundingOpportunity[]> {
  const exchanges = options.exchanges && options.exchanges.length ? options.exchanges : DEFAULT_EXCHANGES;
  const minAbsFundingRate = options.minAbsFundingRate ?? Number(process.env.FUNDING_MIN_ABS_RATE ?? 0.0002);
  const limit = options.limit ?? Number(process.env.FUNDING_MAX_RESULTS ?? 20);
  const results = await Promise.all(exchanges.map((exchange) => loadFundingForExchange(exchange)));
  const flattened = results.flat();
  const filtered = flattened.filter((entry) => Math.abs(entry.fundingRate) >= minAbsFundingRate);
  filtered.sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate));
  return filtered.slice(0, limit);
}
