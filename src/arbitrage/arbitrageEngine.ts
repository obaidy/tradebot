import { ExchangeAdapter, ArbitrageOpportunity } from '../exchanges/adapters/types';
import { logger } from '../utils/logger';

export interface ArbitrageEngineConfig {
  minSpreadPct: number;
  maxLegUsd?: number;
  symbols: string[];
  pollIntervalMs?: number;
}

export class CrossExchangeArbitrageEngine {
  private readonly adapters: ExchangeAdapter[];
  private readonly config: ArbitrageEngineConfig;
  private timer: NodeJS.Timeout | null = null;
  private onOpportunities: ((opportunities: ArbitrageOpportunity[]) => void | Promise<void>) | null = null;

  constructor(adapters: ExchangeAdapter[], config: ArbitrageEngineConfig) {
    this.adapters = adapters;
    this.config = config;
  }

  start(handler?: (opportunities: ArbitrageOpportunity[]) => void | Promise<void>) {
    if (this.timer) return;
    if (handler) {
      this.onOpportunities = handler;
    }
    const interval = this.config.pollIntervalMs ?? 15_000;
    this.timer = setInterval(() => {
      this.scan()
        .then(async (opportunities) => {
          if (!opportunities.length || !this.onOpportunities) return;
          try {
            await this.onOpportunities(opportunities);
          } catch (handlerError) {
            logger.warn('arbitrage_opportunity_handler_failed', {
              event: 'arbitrage_opportunity_handler_failed',
              error: handlerError instanceof Error ? handlerError.message : String(handlerError),
            });
          }
        })
        .catch((err) => {
          logger.warn('arbitrage_scan_failed', {
            event: 'arbitrage_scan_failed',
            error: err instanceof Error ? err.message : String(err),
          });
        });
    }, interval);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async scan(): Promise<ArbitrageOpportunity[]> {
    const opportunities: ArbitrageOpportunity[] = [];
    for (const symbol of this.config.symbols) {
      const quotes = await Promise.allSettled(this.adapters.map((adapter) => adapter.fetchTicker(symbol)));
      const validQuotes = quotes
        .map((result, index) => ({ result, adapter: this.adapters[index] }))
        .filter((item) => item.result.status === 'fulfilled')
        .map((item) => ({
          adapter: item.adapter,
          quote: (item.result as PromiseFulfilledResult<any>).value,
        }))
        .filter((entry) => entry.quote.bid !== null && entry.quote.ask !== null);

      for (let i = 0; i < validQuotes.length; i++) {
        for (let j = 0; j < validQuotes.length; j++) {
          if (i === j) continue;
          const buy = validQuotes[i];
          const sell = validQuotes[j];
          const spread = (sell.quote.bid! - buy.quote.ask!) / buy.quote.ask!;
          if (spread * 100 >= this.config.minSpreadPct) {
            const opportunity: ArbitrageOpportunity = {
              symbol,
              buyExchange: buy.adapter.id,
              sellExchange: sell.adapter.id,
              buyPrice: buy.quote.ask!,
              sellPrice: sell.quote.bid!,
              spreadPct: spread * 100,
              volumeUsd: this.config.maxLegUsd ?? 1000,
            };
            opportunities.push(opportunity);
            logger.info('arbitrage_opportunity_detected', {
              event: 'arbitrage_opportunity_detected',
              ...opportunity,
            });
          }
        }
      }
    }
    return opportunities;
  }
}
