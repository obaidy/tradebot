import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StrategyRunContext } from '../../src/strategies/types';

const connect = vi.fn();
const disconnect = vi.fn();
const fetchTicker = vi.fn();
const changeLeverage = vi.fn();
const placeOrder = vi.fn();

const mockAdapter = {
  connect,
  disconnect,
  fetchTicker,
  changeLeverage,
  placeOrder,
};

const createExchangeAdapter = vi.fn(() => mockAdapter as any);

vi.mock('../../src/exchanges/adapterFactory', () => ({
  createExchangeAdapter,
}));

async function runPerpGridStrategy(ctx: StrategyRunContext) {
  const module = await import('../../src/strategies/perpGridStrategy');
  return module.runPerpGridStrategy(ctx);
}

describe('runPerpGridStrategy', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, DERIVATIVES_EXCHANGE: 'binanceusdm' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws when live mode lacks API credentials', async () => {
    const ctx: StrategyRunContext = {
      clientId: 'client-1',
      planId: 'pro',
      pair: 'BTC/USDT',
      runMode: 'live',
      config: { exchangeId: 'binanceusdm' },
    };

    await expect(runPerpGridStrategy(ctx)).rejects.toThrow('derivatives_api_credentials_missing');
    expect(connect).not.toHaveBeenCalled();
  });

  it('connects adapter and skips orders in paper mode', async () => {
    fetchTicker.mockResolvedValueOnce({ symbol: 'BTC/USDT', last: 25000 });

    const ctx: StrategyRunContext = {
      clientId: 'client-2',
      planId: 'pro',
      pair: 'BTC/USDT',
      runMode: 'paper',
      config: {
        exchangeId: 'binanceusdm',
        apiKey: 'key',
        apiSecret: 'secret',
      },
    };

    await runPerpGridStrategy(ctx);

    expect(createExchangeAdapter).toHaveBeenCalledWith({
      kind: 'derivatives',
      id: 'binanceusdm',
      apiKey: 'key',
      apiSecret: 'secret',
      passphrase: undefined,
      extra: { exchangeId: 'binanceusdm' },
    });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(fetchTicker).toHaveBeenCalledTimes(1);
    expect(changeLeverage).not.toHaveBeenCalled();
    expect(placeOrder).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('places bracket grid orders in live mode', async () => {
    fetchTicker.mockResolvedValueOnce({ symbol: 'BTC/USDT', last: 26000 });
    changeLeverage.mockResolvedValueOnce(undefined);
    placeOrder.mockResolvedValue({ id: 'order', status: 'accepted', filled: 0, remaining: 1 });

    const ctx: StrategyRunContext = {
      clientId: 'client-3',
      planId: 'pro',
      pair: 'BTC/USDT',
      runMode: 'live',
      config: {
        exchangeId: 'binanceusdm',
        apiKey: 'key',
        apiSecret: 'secret',
        leverage: 5,
        orderSize: 0.2,
        priceOffsetPct: 0.4,
      },
    };

    await runPerpGridStrategy(ctx);

    expect(connect).toHaveBeenCalledTimes(1);
    expect(changeLeverage).toHaveBeenCalledWith('BTC/USDT', 5);
    expect(placeOrder).toHaveBeenCalledTimes(2);
    const [buyOrderArgs] = placeOrder.mock.calls[0];
    const [sellOrderArgs] = placeOrder.mock.calls[1];
    expect(buyOrderArgs.side).toBe('buy');
    expect(buyOrderArgs.amount).toBe(0.2);
    expect(buyOrderArgs.price).toBeCloseTo(25896); // 26000 * (1 - 0.004)
    expect(sellOrderArgs.side).toBe('sell');
    expect(sellOrderArgs.price).toBeCloseTo(26104); // 26000 * (1 + 0.004)
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
