import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StrategyRunContext } from '../../src/strategies/types';

const evaluate = vi.fn(async () => true);
const execute = vi.fn(async () => ({ profitUsd: 100, txHash: '0xabc', opportunity: {} as any }));
const scan = vi.fn(async () => [
  {
    symbol: 'ETH/USDC',
    buyExchange: 'a',
    sellExchange: 'b',
    buyPrice: 1000,
    sellPrice: 1010,
    spreadPct: 1,
    volumeUsd: 10000,
  },
]);

vi.mock('../../src/defi/flashLoans/flashLoanEngine', () => ({
  FlashLoanEngine: vi.fn(() => ({ evaluate, execute })),
}));

vi.mock('../../src/arbitrage/arbitrageEngine', () => ({
  CrossExchangeArbitrageEngine: vi.fn(() => ({
    scan,
  })),
}));

vi.mock('../../src/exchanges/adapterFactory', () => ({
  createExchangeAdapter: vi.fn(() => ({ id: 'mock-exchange' })),
}));

async function runStrategy(ctx: StrategyRunContext) {
  const module = await import('../../src/strategies/flashLoanArbStrategy');
  return module.runFlashLoanArbStrategy(ctx);
}

describe('runFlashLoanArbStrategy', () => {
  beforeEach(() => {
    evaluate.mockClear();
    execute.mockClear();
    scan.mockClear();
  });

  it('evaluates opportunities', async () => {
    const ctx: StrategyRunContext = {
      clientId: 'client-flash',
      planId: 'pro',
      pair: 'ETH/USDC',
      runMode: 'paper',
    } as any;

    await runStrategy(ctx);
    expect(scan).toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('executes in live mode when feasible', async () => {
    const ctx: StrategyRunContext = {
      clientId: 'client-flash-live',
      planId: 'pro',
      pair: 'ETH/USDC',
      runMode: 'live',
    } as any;

    await runStrategy(ctx);
    expect(execute).toHaveBeenCalled();
  });
});
