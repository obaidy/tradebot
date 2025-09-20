import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { runMigrations } from '../src/db/migrations';
import { RunsRepository, OrdersRepository, FillsRepository } from '../src/db/repositories';
import { executeBuyLevels, OrderExecutionContext } from '../src/strategies/gridBot';
import { resetMetrics } from '../src/telemetry/metrics';
import { killSwitch } from '../src/guard/killSwitch';

function createPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return { pool, db };
}

describe('executeBuyLevels', () => {
  let pool: any;
  let runsRepo: RunsRepository;
  let ordersRepo: OrdersRepository;
  let fillsRepo: FillsRepository;

  beforeEach(async () => {
    const ctx = createPool();
    pool = ctx.pool;
    await runMigrations(pool);
    await pool.query(
      `INSERT INTO clients (id, name, owner, plan, status)
       VALUES ('client-a', 'Client A', 'tester', 'starter', 'active')
       ON CONFLICT (id) DO NOTHING`
    );
    runsRepo = new RunsRepository(pool, 'client-a');
    ordersRepo = new OrdersRepository(pool, 'client-a');
    fillsRepo = new FillsRepository(pool, 'client-a');
    process.env.ORDER_CONCURRENCY = '2';
    process.env.ORDER_RATE_INTERVAL_MS = '0';
    process.env.REPLACE_SLIPPAGE_PCT = '0.01';
    process.env.REPLACE_TIMEOUT_MS = '1000';
    process.env.REPLACE_MAX_RETRIES = '2';
    process.env.ORDER_POLL_INTERVAL_MS = '10';
    resetMetrics();
    await killSwitch.reset('test');
  });

  it('handles partial fills with replacement and persists state', async () => {
    const runId = 'test-run';
    await runsRepo.createRun({
      runId,
      owner: 'tester',
      exchange: 'mock',
      paramsJson: {},
    });

    const logs: any[] = [];

    class MockExchange {
      private orderCounter = 0;
      private sellCounter = 0;
      private states = new Map<string, any[]>();
      private fetchCount = new Map<string, number>();

      async createLimitBuyOrder(symbol: string, amount: number, price: number) {
        this.orderCounter += 1;
        const id = `buy-${this.orderCounter}`;
        if (this.orderCounter === 1) {
          this.states.set(id, [
            { id, status: 'open', amount, filled: 0, price },
            { id, status: 'open', amount, filled: amount * 0.4, price: price * 0.94 },
          ]);
        } else {
          this.states.set(id, [
            { id, status: 'open', amount, filled: 0, price },
            { id, status: 'closed', amount, filled: amount, price },
          ]);
        }
        this.fetchCount.set(id, 0);
        return { id, amount, price };
      }

      async fetchOrder(id: string) {
        const stateList = this.states.get(id) || [];
        const count = this.fetchCount.get(id) ?? 0;
        const state = stateList[Math.min(count, stateList.length - 1)] || { id, status: 'open', amount: 0, filled: 0 };
        this.fetchCount.set(id, count + 1);
        return state;
      }

      async cancelOrder() {
        return true;
      }

      async createLimitSellOrder(symbol: string, amount: number, price: number) {
        this.sellCounter += 1;
        const id = `sell-${this.sellCounter}`;
        logs.push({ type: 'sell', symbol, amount, price, id });
        return { id, amount, price };
      }

      async fetchTicker() {
        return { bid: 90 };
      }
    }

    const exchange = new MockExchange() as any;

    const appendRows: any[] = [];
    const context: OrderExecutionContext = {
      clientId: 'client-a',
      exchange,
      pair: 'BTC/USDT',
      plan: {
        runId,
        runMode: 'live',
        pair: 'BTC/USDT',
        generatedAt: new Date().toISOString(),
        gridSteps: 1,
        gridSizePct: 0.02,
        perTradeUsd: 1,
        feePct: 0.001,
        buyLevels: [
          {
            price: 100,
            amount: 0.01,
            perTradeUsd: 1,
            correlationId: 'lvl-1',
          },
        ],
        summary: null,
        metadata: {
          mid: 100,
          tickerBid: 100,
          tickerAsk: 100,
          stepSize: 0.0001,
          basePrecision: 4,
          minNotional: null,
        },
      } as any,
      takeProfitPct: 0.02,
      marketMeta: { stepSize: 0.0001, basePrecision: 4, minNotional: null },
      gridSizePct: 0.02,
      timestampProvider: () => new Date().toISOString(),
      ordersRepo,
      fillsRepo,
      buyLevels: [
        {
          price: 100,
          amount: 0.01,
          perTradeUsd: 1,
          correlationId: 'lvl-1',
        },
      ],
      appendCsv: (row) => appendRows.push(row),
      sendNotification: async (message: string) => {
        logs.push({ type: 'notify', message });
      },
    };

    await executeBuyLevels(context);

    const orderRows = await pool.query('SELECT side, status, amount FROM bot_orders ORDER BY id');
    const buyStatuses = orderRows.rows.filter((r: any) => r.side === 'buy').map((r: any) => r.status);
    expect(buyStatuses).toContain('cancelled');
    expect(buyStatuses).toContain('closed');

    const fillSum = await pool.query("SELECT SUM(amount)::float AS total FROM bot_fills WHERE run_id = $1", [runId]);
    expect(fillSum.rows[0].total).toBeGreaterThan(0.0095);

    const sellOrders = orderRows.rows.filter((r: any) => r.side === 'sell');
    expect(sellOrders.length).toBeGreaterThanOrEqual(1);
    expect(appendRows.find((r) => r.status === 'planned')).toBeTruthy();
  });

  afterEach(async () => {
    if (pool) {
      await pool.end();
    }
  });
});
