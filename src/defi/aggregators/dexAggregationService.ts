import { OneInchAggregator } from './oneInchAggregator';
import { ParaSwapAggregator } from './paraswapAggregator';
import type { DexAggregatorClient, DexQuoteRequest, DexQuoteResponse, DexSwapRequest, DexSwapResponse } from './types';

export class DexAggregationService {
  private readonly aggregators: DexAggregatorClient[];

  constructor(clients?: DexAggregatorClient[]) {
    this.aggregators = clients ?? [new OneInchAggregator(), new ParaSwapAggregator()];
  }

  listEnabledAggregators(): DexAggregatorClient[] {
    return this.aggregators.filter((aggregator) => aggregator.isEnabled());
  }

  async quoteBestRoute(request: DexQuoteRequest): Promise<DexQuoteResponse> {
    const enabled = this.listEnabledAggregators();
    if (!enabled.length) {
      throw new Error('dex_aggregator_unavailable');
    }
    const quotes = await Promise.allSettled(enabled.map((aggregator) => aggregator.quote(request)));
    const successful = quotes
      .map((result, index) => ({ result, aggregator: enabled[index] }))
      .filter((entry) => entry.result.status === 'fulfilled')
      .map((entry) => (entry.result as PromiseFulfilledResult<DexQuoteResponse>).value);

    if (!successful.length) {
      throw new Error('dex_aggregator_no_quotes');
    }
    successful.sort((a, b) => Number(b.amountOut) - Number(a.amountOut));
    return successful[0];
  }

  async executeSwap(request: DexSwapRequest): Promise<DexSwapResponse> {
    const enabled = this.listEnabledAggregators();
    if (!enabled.length) {
      throw new Error('dex_aggregator_unavailable');
    }

    const preferred = enabled.find((aggregator) => aggregator.id === request.aggregator) || enabled[0];
    return preferred.executeSwap(request);
  }
}
