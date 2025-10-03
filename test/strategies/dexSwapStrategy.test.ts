import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StrategyRunContext } from '../../src/strategies/types';

const connect = vi.fn();
const disconnect = vi.fn();
const estimateSwap = vi.fn();
const executeSwap = vi.fn();

const mockAdapter = {
  connect,
  disconnect,
  estimateSwap,
  executeSwap,
};

const createExchangeAdapter = vi.fn(() => mockAdapter as any);

vi.mock('../../src/exchanges/adapterFactory', () => ({
  createExchangeAdapter,
}));

async function runDexSwapStrategy(ctx: StrategyRunContext) {
  const module = await import('../../src/strategies/dexSwapStrategy');
  return module.runDexSwapStrategy(ctx);
}

describe('runDexSwapStrategy', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, DEX_ROUTER_ADDRESS: '0xrouter' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('connects adapter and skips execution in paper mode', async () => {
    const ctx: StrategyRunContext = {
      clientId: 'client-1',
      planId: 'pro',
      pair: 'WETH/USDC',
      runMode: 'paper',
      config: {
        tokenIn: 'WETH',
        tokenOut: 'USDC',
        amountIn: 1.2,
        rpcUrl: 'http://localhost:8545',
        privateKey: '0xabc',
      },
    };

    await runDexSwapStrategy(ctx);

    expect(createExchangeAdapter).toHaveBeenCalledWith({
      kind: 'dex',
      id: 'dex-router',
      rpcUrl: 'http://localhost:8545',
      privateKey: '0xabc',
      extra: { routerAddress: '0xrouter' },
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(estimateSwap).not.toHaveBeenCalled();
    expect(executeSwap).not.toHaveBeenCalled();
  });

  it('executes swap with slippage controls in live mode', async () => {
    estimateSwap.mockResolvedValueOnce(1000);
    executeSwap.mockResolvedValueOnce('0xtx');

    const ctx: StrategyRunContext = {
      clientId: 'client-2',
      planId: 'pro',
      pair: 'WETH/USDC',
      runMode: 'live',
      config: {
        tokenIn: 'WETH',
        tokenOut: 'USDC',
        amountIn: 2,
        rpcUrl: 'http://localhost:8545',
        privateKey: '0xdef',
        recipient: '0xrecipient',
        slippagePct: 1.5,
      },
    };

    await runDexSwapStrategy(ctx);

    expect(createExchangeAdapter).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(estimateSwap).toHaveBeenCalledWith({ tokenIn: 'WETH', tokenOut: 'USDC', amountIn: 2 });
    expect(executeSwap).toHaveBeenCalledTimes(1);
    const callArgs = executeSwap.mock.calls[0][0];
    expect(callArgs.tokenIn).toBe('WETH');
    expect(callArgs.tokenOut).toBe('USDC');
    expect(callArgs.amountIn).toBe(2);
    expect(callArgs.recipient).toBe('0xrecipient');
    expect(callArgs.minAmountOut).toBeCloseTo(985); // 1000 * (1 - 0.015)
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
