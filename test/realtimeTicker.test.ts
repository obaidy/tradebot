import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const gatewayMock = vi.hoisted(() => ({
  watchSymbol: vi.fn(),
  getLatestTicker: vi.fn(),
  waitForFreshTicker: vi.fn(),
  recordRestFallback: vi.fn(),
}));

vi.mock('../src/services/streaming/binanceGateway', () => ({
  binanceStreamingGateway: gatewayMock,
}));

describe('getRealtimeTicker', () => {
  beforeEach(() => {
    vi.resetModules();
    gatewayMock.watchSymbol.mockReset();
    gatewayMock.getLatestTicker.mockReset();
    gatewayMock.waitForFreshTicker.mockReset();
    gatewayMock.recordRestFallback.mockReset();
    gatewayMock.getLatestTicker.mockReturnValue(null);
    gatewayMock.waitForFreshTicker.mockResolvedValue(null);
    delete process.env.STREAMING_STALE_TICKER_MS;
    process.env.ENABLE_STREAMING_GATEWAY = 'true';
    process.env.STREAMING_WAIT_FOR_SNAPSHOT_MS = '0';
  });

  afterEach(() => {
    delete process.env.ENABLE_STREAMING_GATEWAY;
    delete process.env.STREAMING_WAIT_FOR_SNAPSHOT_MS;
    vi.useRealTimers();
  });

  it('falls back to REST for non-binance exchanges', async () => {
    const fallback = vi.fn().mockResolvedValue({ bid: 100, ask: 101, last: 100.5, timestamp: 1234 });
    const { getRealtimeTicker } = await import('../src/services/marketData/realtimeTicker');
    const ticker = await getRealtimeTicker({
      exchangeId: 'kraken',
      pair: 'BTC/USD',
      fallback,
    });

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(gatewayMock.watchSymbol).not.toHaveBeenCalled();
    expect(ticker.source).toBe('rest');
    expect(ticker.bid).toBe(100);
    expect(ticker.ask).toBe(101);
  });

  it('returns websocket data when snapshot is fresh', async () => {
    const current = Date.now();
    gatewayMock.getLatestTicker.mockReturnValue({
      symbol: 'btcusdt',
      bidPrice: 200,
      askPrice: 201,
      bidQty: 5,
      askQty: 5,
      eventTime: current,
      updateId: 10,
      receivedAt: current,
      source: 'ws',
    });
    gatewayMock.waitForFreshTicker.mockResolvedValue(null);
    const fallback = vi.fn();

    const { getRealtimeTicker } = await import('../src/services/marketData/realtimeTicker');
    const ticker = await getRealtimeTicker({
      exchangeId: 'binance',
      pair: 'BTC/USDT',
      fallback,
    });

    expect(gatewayMock.watchSymbol).toHaveBeenCalledWith('BTC/USDT');
    expect(fallback).not.toHaveBeenCalled();
    expect(ticker.source).toBe('ws');
    expect(ticker.bid).toBe(200);
    expect(ticker.ask).toBe(201);
  });

  it('uses fallback when websocket data is stale', async () => {
    vi.useFakeTimers();
    const baseTime = new Date('2024-01-01T00:00:00Z');
    vi.setSystemTime(baseTime);
    gatewayMock.getLatestTicker.mockReturnValue({
      symbol: 'ethusdt',
      bidPrice: 1500,
      askPrice: 1501,
      bidQty: 1,
      askQty: 1,
      eventTime: baseTime.getTime() - 5000,
      updateId: 5,
      receivedAt: baseTime.getTime() - 5000,
      source: 'ws',
    });
    gatewayMock.waitForFreshTicker.mockResolvedValue(null);
    process.env.STREAMING_STALE_TICKER_MS = '1000';

    const fallback = vi.fn().mockResolvedValue({ bid: 1498, ask: 1499, timestamp: baseTime.getTime() });
    const { getRealtimeTicker } = await import('../src/services/marketData/realtimeTicker');
    const ticker = await getRealtimeTicker({
      exchangeId: 'binance',
      pair: 'ETH/USDT',
      fallback,
    });

    expect(fallback).toHaveBeenCalledTimes(1);
    expect(ticker.source).toBe('rest');
    expect(ticker.bid).toBe(1498);
    expect(gatewayMock.recordRestFallback).toHaveBeenCalledWith('ETH/USDT', expect.objectContaining({ bid: 1498 }));
  });
});
