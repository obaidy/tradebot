import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { Pool } from 'pg';
import { runMigrations } from '../src/db/migrations';
import { OrdersRepository, FillsRepository } from '../src/db/repositories';
import { executeBuyLevels, OrderExecutionContext } from '../src/strategies/gridBot';
import { resetMetrics } from '../src/telemetry/metrics';
import { killSwitch } from '../src/guard/killSwitch';

function createPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return { pool, db };
}

describe('shared rate limiter', () => {
  let pool: Pool;
  let originalInterval: string | undefined;

  beforeEach(async () => {
    const ctx = createPool();
    pool = ctx.pool as unknown as Pool;
    await runMigrations(pool);
    await pool.query(
      `INSERT INTO clients (id, name, owner, plan, status)
       VALUES ('client-limit', 'Client Limit', 'owner', 'starter', 'active')
       ON CONFLICT (id) DO NOTHING`
    );
    await pool.query(
      `INSERT INTO clients (id, name, owner, plan, status)
       VALUES ('client-alt', 'Client Alt', 'owner', 'starter', 'active')
       ON CONFLICT (id) DO NOTHING`
    );
    originalInterval = process.env.ORDER_RATE_INTERVAL_MS;
    process.env.ORDER_RATE_INTERVAL_MS = '75';
    resetMetrics();
    await killSwitch.reset('test');
  });

  afterEach(async () => {
    if (originalInterval === undefined) {
      delete process.env.ORDER_RATE_INTERVAL_MS;
    } else {
      process.env.ORDER_RATE_INTERVAL_MS = originalInterval;
    }
    if (pool) {
      await (pool as any).end();
    }
  });

  function buildContext(clientId: string): OrderExecutionContext {
    return {
      clientId,
      exchange: {} as any,
      pair: 'BTC/USDT',
      plan: {
        runId: `run-${clientId}-${Date.now()}`,
        runMode: 'paper',
        pair: 'BTC/USDT',
        generatedAt: new Date().toISOString(),
        gridSteps: 0,
        gridSizePct: 0,
        perTradeUsd: 0,
        feePct: 0,
        buyLevels: [],
        summary: null,
        metadata: {
          mid: 0,
          tickerBid: 0,
          tickerAsk: 0,
          stepSize: 0.0001,
          basePrecision: 4,
          minNotional: null,
        },
        plannedExposureUsd: 0,
      } as any,
      takeProfitPct: 0.01,
      marketMeta: { stepSize: 0.0001, basePrecision: 4, minNotional: null },
      gridSizePct: 0.01,
      timestampProvider: () => new Date().toISOString(),
      ordersRepo: new OrdersRepository(pool, clientId),
      fillsRepo: new FillsRepository(pool, clientId),
      buyLevels: [],
      appendCsv: () => {},
      pendingTpPromises: [],
      metrics: undefined,
      limiter: undefined,
    };
  }

  it('reuses limiter instances per client and isolates across clients', async () => {
    const ctxA1 = buildContext('client-limit');
    await executeBuyLevels(ctxA1);
    const ctxA2 = buildContext('client-limit');
    await executeBuyLevels(ctxA2);

    expect(ctxA1.limiter).toBeDefined();
    expect(ctxA2.limiter).toBeDefined();
    expect(ctxA1.limiter).toBe(ctxA2.limiter);

    const ctxB = buildContext('client-alt');
    await executeBuyLevels(ctxB);

    expect(ctxB.limiter).toBeDefined();
    expect(ctxB.limiter).not.toBe(ctxA1.limiter);
  });
});
