import { describe, it, expect } from 'vitest';
import { DexAggregationService } from '../../src/defi/aggregators/dexAggregationService';
import type { DexAggregatorClient, DexQuoteRequest, DexQuoteResponse, DexSwapRequest, DexSwapResponse } from '../../src/defi/aggregators/types';

class MockAggregator implements DexAggregatorClient {
  constructor(
    public readonly id: string,
    private readonly enabled: boolean,
    private readonly amountOut: number,
  ) {}

  isEnabled(): boolean {
    return this.enabled;
  }

  async quote(params: DexQuoteRequest): Promise<DexQuoteResponse> {
    return {
      aggregator: this.id,
      amountIn: params.amountIn,
      amountOut: this.amountOut.toString(),
      route: [],
      rawQuote: {},
    };
  }

  async executeSwap(params: DexSwapRequest): Promise<DexSwapResponse> {
    return {
      aggregator: this.id,
      txHash: `${this.id}-tx`,
      amountIn: params.amountIn,
      amountOut: params.minAmountOut,
      route: [],
      rawTx: {},
    };
  }
}

describe('DexAggregationService', () => {
  const quoteRequest: DexQuoteRequest = {
    chainId: 1,
    tokenIn: 'ETH',
    tokenOut: 'USDC',
    amountIn: '1',
  };

  it('selects the enabled aggregator with the best quote', async () => {
    const service = new DexAggregationService([
      new MockAggregator('disabled', false, 0),
      new MockAggregator('good', true, 1050),
      new MockAggregator('better', true, 1100),
    ]);

    const result = await service.quoteBestRoute(quoteRequest);
    expect(result.aggregator).toBe('better');
    expect(result.amountOut).toBe('1100');
  });

  it('executes swap against preferred aggregator', async () => {
    const service = new DexAggregationService([
      new MockAggregator('first', true, 1000),
      new MockAggregator('second', true, 1010),
    ]);

    const swap = await service.executeSwap({
      ...quoteRequest,
      minAmountOut: '1000',
      recipient: '0xabc',
      aggregator: 'second',
    });

    expect(swap.aggregator).toBe('second');
    expect(swap.txHash).toBe('second-tx');
  });
});
