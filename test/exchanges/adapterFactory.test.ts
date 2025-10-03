import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createExchangeAdapter } from '../../src/exchanges/adapterFactory';
import { CrossExchangeArbitrageEngine } from '../../src/arbitrage/arbitrageEngine';

vi.mock('ccxt', () => {
  class MockExchange {
    id = 'mock';
    has = { futures: true, margin: true, spot: true };
    async loadMarkets() {}
    async fetchBalance() {
      return { total: { BTC: 1 } };
    }
    async fetchOpenOrders() {
      return [];
    }
    async fetchTicker() {
      return { bid: 100, ask: 101, last: 100.5, timestamp: Date.now() };
    }
    async createOrder(symbol: string, type: string, side: string, amount: number, price?: number) {
      return {
        id: `${symbol}-${type}-${side}`,
        status: 'closed',
        filled: amount,
        remaining: 0,
        average: price ?? 0,
      };
    }
    async cancelOrder() {}
    async close() {}
  }

  class MockPerpExchange extends MockExchange {}

  return {
    default: {
      binance: MockExchange,
      binanceusdm: MockPerpExchange,
    },
    binance: MockExchange,
    binanceusdm: MockPerpExchange,
  };
});

const mockProvider = {
  getBalance: vi.fn(async () => BigInt(1e18)),
  getNetwork: vi.fn(async () => ({ chainId: 1 })),
};

vi.mock('ethers', () => {
  class MockWallet {
    address = '0x1234';
    provider: any;
    constructor(_pk: string, provider: any) {
      this.provider = provider;
    }
  }

  return {
    JsonRpcProvider: vi.fn(() => mockProvider),
    Wallet: MockWallet,
    ZeroAddress: '0x0000000000000000000000000000000000000000',
    formatEther: (value: bigint) => (Number(value) / 1e18).toString(),
    type: {},
  };
});

describe('exchange adapter factory', () => {
  beforeEach(() => {
    mockProvider.getBalance.mockClear();
    mockProvider.getNetwork.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates ccxt spot adapter with futures support', async () => {
    const adapter = createExchangeAdapter({ kind: 'ccxt', id: 'binance' });
    await adapter.connect();
    expect(adapter.supportsSpot).toBe(true);
    expect(adapter.supportsFutures).toBe(true);
    const balances = await adapter.fetchBalances();
    expect(balances.BTC).toBe(1);
    await adapter.disconnect();
  });

  it('creates derivatives adapter and places orders', async () => {
    const adapter = createExchangeAdapter({ kind: 'derivatives', id: 'binanceusdm', apiKey: 'key', apiSecret: 'secret' });
    await adapter.connect();
    expect(adapter.supportsFutures).toBe(true);
    const ticker = await adapter.fetchTicker('BTC/USDT');
    expect(ticker.bid).toBe(100);
    const order = await adapter.placeOrder({ symbol: 'BTC/USDT', side: 'buy', amount: 1, price: 100, type: 'limit' });
    expect(order.status).toBe('closed');
    await adapter.disconnect();
  });

  it('creates DEX adapter and fetches balances', async () => {
    const adapter = createExchangeAdapter({
      kind: 'dex',
      id: 'dex',
      rpcUrl: 'http://localhost:8545',
      privateKey: '0xabc',
    });
    await adapter.connect();
    const balances = await adapter.fetchBalances();
    expect(balances.ETH).toBeDefined();
    await adapter.disconnect();
  });
});

describe('CrossExchangeArbitrageEngine', () => {
  it('detects spread opportunities', async () => {
    const buyAdapter = {
      id: 'buy',
      type: 'spot',
      supportsFutures: false,
      supportsSpot: true,
      supportsMargin: false,
      connect: vi.fn(),
      disconnect: vi.fn(),
      fetchBalances: vi.fn(),
      fetchOpenOrders: vi.fn(),
      fetchTicker: vi.fn(async () => ({ symbol: 'BTC/USDT', bid: 100, ask: 101, last: 100.5, timestamp: Date.now() })),
      placeOrder: vi.fn(),
      cancelOrder: vi.fn(),
    } as any;

    const sellAdapter = {
      ...buyAdapter,
      id: 'sell',
      fetchTicker: vi.fn(async () => ({ symbol: 'BTC/USDT', bid: 103, ask: 104, last: 103.5, timestamp: Date.now() })),
    } as any;

    const engine = new CrossExchangeArbitrageEngine([buyAdapter, sellAdapter], {
      symbols: ['BTC/USDT'],
      minSpreadPct: 1,
      maxLegUsd: 1000,
    });

    const opportunities = await engine.scan();
    expect(opportunities.length).toBeGreaterThan(0);
    expect(opportunities[0].spreadPct).toBeGreaterThanOrEqual(1);
  });
});
