import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { runMigrations } from '../src/db/migrations';
import { RunsRepository, OrdersRepository, FillsRepository } from '../src/db/repositories';
import { GuardStateRepository } from '../src/db/guardStateRepo';
import { CircuitBreaker } from '../src/guard/circuitBreaker';
import { reconcileOpenOrders, ExchangeLike } from '../src/services/reconciliation';

function createInMemoryPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return { pool, db };
}

describe('Persistence layer', () => {
  let pool: any;
  let runsRepo: RunsRepository;
  let ordersRepo: OrdersRepository;
  let fillsRepo: FillsRepository;

  beforeEach(async () => {
    const ctx = createInMemoryPool();
    pool = ctx.pool;
    await runMigrations(pool);
    runsRepo = new RunsRepository(pool);
    ordersRepo = new OrdersRepository(pool);
    fillsRepo = new FillsRepository(pool);
  });

  afterEach(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('creates a run and updates status', async () => {
    await runsRepo.createRun({
      runId: 'run-1',
      owner: 'tester',
      clientId: 'client-a',
      exchange: 'binance',
      paramsJson: { foo: 'bar' },
      rateLimitMeta: { rateLimit: 1200 },
      marketSnapshot: { bid: 1, ask: 2 },
    });

    const res = await pool.query('SELECT * FROM bot_runs WHERE run_id = $1', ['run-1']);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].owner).toBe('tester');
    expect(res.rows[0].status).toBe('running');

    await runsRepo.updateStatus({ runId: 'run-1', status: 'completed' });
    const updated = await pool.query('SELECT status FROM bot_runs WHERE run_id = $1', ['run-1']);
    expect(updated.rows[0].status).toBe('completed');
    expect(updated.rows[0].ended_at).not.toBeNull();
  });

  it('reconciles open orders and records fills', async () => {
    await runsRepo.createRun({
      runId: 'run-2',
      owner: 'tester',
      clientId: 'client-a',
      exchange: 'binance',
      paramsJson: {},
    });

    const order = await ordersRepo.insertOrder({
      runId: 'run-2',
      exchangeOrderId: 'ex-order-1',
      pair: 'BTC/USDT',
      side: 'buy',
      price: 100,
      amount: 0.01,
      status: 'placed',
      remainingAmount: 0.01,
    });

    class MockExchange implements ExchangeLike {
      constructor(private readonly responses: Record<string, any>) {}
      async fetchOrder(id: string) {
        if (!this.responses[id]) {
          throw new Error('Order not found');
        }
        return this.responses[id];
      }
    }

    const mock = new MockExchange({
      'ex-order-1': {
        id: 'ex-order-1',
        status: 'closed',
        amount: 0.01,
        filled: 0.01,
        price: 100,
        side: 'buy',
        timestamp: Date.now(),
      },
    });

    const result = await reconcileOpenOrders(pool, { orders: ordersRepo, runs: runsRepo, fills: fillsRepo }, mock);
    expect(result.reconciled).toBe(1);

    const updatedOrder = await pool.query('SELECT status, filled_amount FROM bot_orders WHERE id = $1', [order.id]);
    expect(updatedOrder.rows[0].status).toBe('closed');
    expect(Number(updatedOrder.rows[0].filled_amount)).toBeCloseTo(0.01);

    const fills = await pool.query('SELECT * FROM bot_fills WHERE order_id = $1', [order.id]);
    expect(fills.rows).toHaveLength(1);
    expect(Number(fills.rows[0].amount)).toBeCloseTo(0.01);
  });

  it('flags drift when exchange order missing', async () => {
    await runsRepo.createRun({
      runId: 'run-3',
      owner: 'tester',
      clientId: 'client-a',
      exchange: 'binance',
      paramsJson: {},
    });

    const order = await ordersRepo.insertOrder({
      runId: 'run-3',
      exchangeOrderId: 'missing-order',
      pair: 'ETH/USDT',
      side: 'buy',
      price: 100,
      amount: 0.5,
      status: 'placed',
    });

    class MissingExchange implements ExchangeLike {
      async fetchOrder() {
        throw new Error('not found');
      }
    }

    const result = await reconcileOpenOrders(pool, { orders: ordersRepo, runs: runsRepo, fills: fillsRepo }, new MissingExchange());
    expect(result.mismatches).toBe(1);

    const updatedOrder = await pool.query('SELECT drift_reason FROM bot_orders WHERE id = $1', [order.id]);
    expect(updatedOrder.rows[0].drift_reason).toContain('not found');
  });

  it('persists guard state across restarts', async () => {
    const guardRepo = new GuardStateRepository(pool);
    const breaker = new CircuitBreaker({
      maxGlobalDrawdownUsd: 100,
      maxRunLossUsd: 50,
      maxApiErrorsPerMin: 10,
      staleTickerMs: 60_000,
    });
    await breaker.initialize(guardRepo);
    await breaker.resetRun();
    breaker.recordFill('buy', 100, 0.01, 0);
    breaker.recordFill('sell', 110, 0.01, 0);
    breaker.recordApiError('test');
    breaker.recordTicker(Date.now());

    const stored = await guardRepo.load();
    expect(stored.globalPnl).toBeGreaterThan(0);
    expect(stored.runPnl).toBeGreaterThan(0);
    expect(stored.inventoryBase).toBeCloseTo(0, 5);
    expect(Array.isArray(stored.apiErrorTimestamps)).toBe(true);
  });
});
