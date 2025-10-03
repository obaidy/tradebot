import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StrategyRunContext } from '../../src/strategies/types';

const quote = {
  aggregator: 'mock-agg',
  amountIn: '1',
  amountOut: '1100',
  route: [],
  rawQuote: {},
};

const swap = {
  aggregator: 'mock-agg',
  txHash: '0xtx',
  amountIn: '1',
  amountOut: '1100',
  route: [],
  rawTx: {},
};

const quoteBestRoute = vi.fn(async () => quote);
const executeSwap = vi.fn(async () => swap);

vi.mock('../../src/defi/aggregators/dexAggregationService', () => ({
  DexAggregationService: vi.fn(() => ({ quoteBestRoute, executeSwap })),
}));

async function runStrategy(ctx: StrategyRunContext) {
  const module = await import('../../src/strategies/dexAggregationStrategy');
  return module.runDexAggregationStrategy(ctx);
}

describe('runDexAggregationStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    quoteBestRoute.mockResolvedValue(quote);
    executeSwap.mockResolvedValue(swap);
  });

  it('quotes and logs in paper mode', async () => {
    const ctx: StrategyRunContext = {
      clientId: 'client-agg',
      planId: 'pro',
      pair: 'ETH/USDC',
      runMode: 'paper',
      config: {
        amountIn: 1,
      },
    } as any;

    await runStrategy(ctx);
    expect(quoteBestRoute).toHaveBeenCalled();
    expect(executeSwap).not.toHaveBeenCalled();
  });

  it('executes swap in live mode', async () => {
    const ctx: StrategyRunContext = {
      clientId: 'client-agg-live',
      planId: 'pro',
      pair: 'ETH/USDC',
      runMode: 'live',
      config: {
        amountIn: 1,
        aggregator: 'mock-agg',
      },
    } as any;

    await runStrategy(ctx);
    expect(executeSwap).toHaveBeenCalled();
  });
});
