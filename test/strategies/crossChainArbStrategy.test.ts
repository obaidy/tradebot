import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StrategyRunContext } from '../../src/strategies/types';

const evaluate = vi.fn(async () => ({
  opportunity: {
    symbol: 'ETH/USDC',
    buyExchange: 'a',
    sellExchange: 'b',
    buyPrice: 1000,
    sellPrice: 1020,
    spreadPct: 2,
    volumeUsd: 5000,
  },
  bridgeUsed: {
    sourceChainId: 1,
    destinationChainId: 137,
    bridge: 'stargate',
    estimatedFeeUsd: 10,
    estimatedDurationSec: 200,
  },
  netProfitUsd: 90,
  etaSeconds: 200,
}));

const scan = vi.fn(async () => [
  {
    symbol: 'ETH/USDC',
    buyExchange: 'a',
    sellExchange: 'b',
    buyPrice: 1000,
    sellPrice: 1020,
    spreadPct: 2,
    volumeUsd: 5000,
  },
]);

vi.mock('../../src/defi/crossChain/crossChainArbEngine', () => ({
  CrossChainArbEngine: vi.fn(() => ({
    evaluate,
  })),
}));

vi.mock('../../src/arbitrage/arbitrageEngine', () => ({
  CrossExchangeArbitrageEngine: vi.fn(() => ({
    scan,
  })),
}));

vi.mock('../../src/exchanges/adapterFactory', () => ({
  createExchangeAdapter: vi.fn(() => ({ id: 'mock' })),
}));

async function runStrategy(ctx: StrategyRunContext) {
  const module = await import('../../src/strategies/crossChainArbStrategy');
  return module.runCrossChainArbStrategy(ctx);
}

describe('runCrossChainArbStrategy', () => {
  beforeEach(() => {
    evaluate.mockClear();
    scan.mockClear();
  });

  it('evaluates opportunities and logs in paper mode', async () => {
    const ctx: StrategyRunContext = {
      clientId: 'client-cross',
      planId: 'pro',
      pair: 'ETH/USDC',
      runMode: 'paper',
    } as any;

    await runStrategy(ctx);
    expect(scan).toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalled();
  });
});
