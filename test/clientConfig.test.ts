import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { Pool } from 'pg';
import { runMigrations } from '../src/db/migrations';
import { ClientConfigService } from '../src/services/clientConfig';
import { ClientsRepository } from '../src/db/clientsRepo';
import { initSecretManager } from '../src/secrets/secretManager';

function createPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return { pool, db };
}

describe('ClientConfigService', () => {
  let pool: Pool;
  let clientsRepo: ClientsRepository;
  let service: ClientConfigService;

  beforeEach(async () => {
    const ctx = createPool();
    pool = ctx.pool as unknown as Pool;
    await runMigrations(pool);
    clientsRepo = new ClientsRepository(pool);
    await clientsRepo.upsert({
      id: 'client-a',
      name: 'Client A',
      owner: 'owner-a',
      plan: 'starter',
      contactInfo: { email: 'a@example.com' },
      limits: {
        risk: {
          bankrollUsd: 500,
          maxPerTradePct: 0.03,
          dailyLossStopPct: 0.04,
          perTradeUsd: 25,
        },
        exchange: {
          primary: 'binance',
        },
        guard: {
          maxGlobalDrawdownUsd: 150,
          maxRunLossUsd: 60,
          maxApiErrorsPerMin: 7,
          staleTickerMs: 90_000,
        },
      },
    });
    process.env.CLIENT_MASTER_KEY = 'test-master-key';
    await initSecretManager('test-master-key');
    service = new ClientConfigService(pool, { allowedClientId: 'client-a', defaultExchange: 'binance' });
  });

  afterEach(async () => {
    if (pool) {
      await (pool as any).end();
    }
  });

  it('returns client profile with risk overrides', async () => {
    const profile = await service.getClientProfile('client-a');
    expect(profile.client.id).toBe('client-a');
    expect(profile.risk.bankrollUsd).toBeCloseTo(500);
    expect(profile.risk.maxPerTradePct).toBeCloseTo(0.03);
    expect(profile.risk.perTradeUsd).toBe(25);
    expect(profile.exchangeId).toBe('binance');
    expect(profile.guard.maxGlobalDrawdownUsd).toBe(150);
    expect(profile.guard.maxApiErrorsPerMin).toBe(7);
    expect(profile.operations.maxPerTradeUsd).toBe(25);
  });

  it('stores and retrieves encrypted credentials', async () => {
    await service.storeExchangeCredentials({
      clientId: 'client-a',
      exchangeName: 'binance',
      apiKey: 'api-key-123',
      apiSecret: 'api-secret-xyz',
      passphrase: 'pass-phrase',
    });

    const config = await service.getClientConfig('client-a');
    expect(config.exchange.apiKey).toBe('api-key-123');
    expect(config.exchange.apiSecret).toBe('api-secret-xyz');
    expect(config.exchange.passphrase).toBe('pass-phrase');
    expect(config.guard.maxRunLossUsd).toBe(60);
    expect(config.operations.maxPerTradeUsd).toBe(25);
  });

  it('enforces client scoping', async () => {
    await expect(service.getClientProfile('client-b')).rejects.toThrow(/client_id=client-a/);
  });

  it('throws when credentials missing in live mode', async () => {
    // Remove any stored credentials to simulate missing secrets
    const guardedService = new ClientConfigService(pool, {
      allowedClientId: 'client-a',
      defaultExchange: 'binance',
    });
    await expect(guardedService.getClientConfig('client-a')).rejects.toThrow(/Missing API credentials/);
  });
});
