import { describe, it, expect, vi } from 'vitest';
import type { StrategyRunContext } from '../../src/strategies/types';

const deploy = vi.fn(async () => ({
  protocol: 'uniswap-v3',
  poolAddress: '0xPool',
  chainId: 1,
  depositedToken: 'USDC',
  depositedAmount: 1000,
}));
const harvest = vi.fn(async (position) => ({ ...position, pendingRewardsAmount: 10 }));
const unwind = vi.fn(async () => {});

vi.mock('../../src/defi/yield/yieldFarmManager', () => ({
  YieldFarmManager: vi.fn(() => ({
    deployLiquidity: deploy,
    harvestRewards: harvest,
    unwind,
  })),
}));

async function runStrategy(ctx: StrategyRunContext) {
  const module = await import('../../src/strategies/yieldFarmingStrategy');
  return module.runYieldFarmingStrategy(ctx);
}

describe('runYieldFarmingStrategy', () => {
  it('deploys and harvests when live', async () => {
    const ctx: StrategyRunContext = {
      clientId: 'client-yield',
      planId: 'pro',
      pair: 'USDC/ETH',
      runMode: 'live',
    } as any;

    await runStrategy(ctx);
    expect(deploy).toHaveBeenCalled();
    expect(harvest).toHaveBeenCalled();
  });

  it('skips unwind in paper mode', async () => {
    const ctx: StrategyRunContext = {
      clientId: 'client-yield-paper',
      planId: 'pro',
      pair: 'USDC/ETH',
      runMode: 'paper',
    } as any;

    await runStrategy(ctx);
    expect(unwind).not.toHaveBeenCalled();
  });
});
