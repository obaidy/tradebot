import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newDb } from 'pg-mem';
import { Pool } from 'pg';
import { runMigrations } from '../src/db/migrations';
import { ClientsRepository } from '../src/db/clientsRepo';
import { runGridOnce } from '../src/strategies/gridBot';
import * as poolModule from '../src/db/pool';
import * as exchangeModule from '../src/exchanges/ccxtClient';
import { RunsRepository } from '../src/db/repositories';
import { killSwitch } from '../src/guard/killSwitch';

function createPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return { pool, db };
}

describe('runGridOnce plan enforcement', () => {
  let pool: Pool;
  let clientsRepo: ClientsRepository;
  let runsRepo: RunsRepository;
  const originalSummaryOnly = process.env.SUMMARY_ONLY;

  beforeEach(async () => {
    const ctx = createPool();
    pool = ctx.pool as unknown as Pool;
    await runMigrations(pool);
    clientsRepo = new ClientsRepository(pool);
    runsRepo = new RunsRepository(pool, 'client-test');
    process.env.SUMMARY_ONLY = 'true';
    vi.spyOn(poolModule, 'getPool').mockReturnValue(pool);
    vi.spyOn(poolModule, 'closePool').mockResolvedValue();
    vi.spyOn(exchangeModule, 'getExchange').mockReturnValue({
      id: 'binance',
      fees: { trading: { taker: 0.001 } },
      fetchTicker: async () => ({ bid: 100, ask: 101, timestamp: Date.now() }),
      fetchOHLCV: async () => Array.from({ length: 200 }).map((_, idx) => [
        Date.now() - idx * 60_000,
        95,
        105,
        94,
        100,
        10,
      ]),
    } as any);
    await killSwitch.reset('test');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await killSwitch.reset('test');
    process.env.SUMMARY_ONLY = originalSummaryOnly;
    if (pool) {
      await (pool as any).end();
    }
  });

  it('blocks live runs when plan forbids them', async () => {
    await clientsRepo.upsert({
      id: 'client-test',
      name: 'Test Client',
      owner: 'tester',
      plan: 'starter',
      status: 'active',
      limits: {
        guard: {
          maxGlobalDrawdownUsd: 200,
          maxRunLossUsd: 100,
          maxApiErrorsPerMin: 8,
          staleTickerMs: 180_000,
        },
        risk: {
          maxPerTradeUsd: 200,
          maxExposureUsd: 1500,
        },
        maxSymbols: 3,
        allowLiveTrading: false,
        paperOnly: true,
        allowedExchanges: ['binance'],
        maxPerTradeUsd: 200,
        maxExposureUsd: 1500,
        maxDailyVolumeUsd: 5000,
      },
    });

    await expect(
      runGridOnce('BTC/USDT', undefined, undefined, {
        clientId: 'client-test',
        runMode: 'live',
      })
    ).rejects.toThrow(/paper trading/);
  });

  it('enforces daily volume ceiling', async () => {
    await clientsRepo.upsert({
      id: 'client-test',
      name: 'Volume Client',
      owner: 'tester',
      plan: 'pro',
      status: 'active',
      limits: {
        guard: {
          maxGlobalDrawdownUsd: 1000,
          maxRunLossUsd: 400,
          maxApiErrorsPerMin: 12,
          staleTickerMs: 90_000,
        },
        risk: {
          maxPerTradeUsd: 2000,
          maxExposureUsd: 10000,
        },
        maxSymbols: 10,
        allowLiveTrading: true,
        paperOnly: false,
        allowedExchanges: ['binance'],
        maxPerTradeUsd: 2000,
        maxExposureUsd: 10000,
        maxDailyVolumeUsd: 5000,
      },
    });

    const existingRunId = 'run-existing';
    await runsRepo.createRun({
      runId: existingRunId,
      owner: 'tester',
      exchange: 'binance',
      paramsJson: {
        runMode: 'paper',
        pair: 'BTC/USDT',
        plannedExposureUsd: 5000,
      },
    });
    await runsRepo.updateStatus({ runId: existingRunId, status: 'completed' });

    await expect(
      runGridOnce('BTC/USDT', undefined, undefined, {
        clientId: 'client-test',
        runMode: 'paper',
      })
    ).rejects.toThrow(/Daily planned volume/);
  });
});
