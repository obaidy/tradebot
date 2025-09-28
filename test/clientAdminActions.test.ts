import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { runMigrations } from '../src/db/migrations';
import {
  ClientsRepository,
  ClientApiCredentialsRepository,
  ClientStrategySecretsRepository,
} from '../src/db/clientsRepo';
import { ClientConfigService } from '../src/services/clientConfig';
import {
  deleteClientCredentials,
  fetchClientSnapshot,
  fetchClients,
  listClientCredentials,
  fetchStrategySecretSummary,
  storeStrategySecretRecord,
  storeClientCredentials,
  upsertClientRecord,
  deleteStrategySecretRecord,
} from '../src/admin/clientAdminActions';
import { ethers } from 'ethers';

function createPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return { pool, db };
}

describe('clientAdminActions', () => {
  let pool: any;
  let clientsRepo: ClientsRepository;
  let credsRepo: ClientApiCredentialsRepository;
  let configService: ClientConfigService;
  let strategySecretsRepo: ClientStrategySecretsRepository;

  beforeEach(async () => {
    const ctx = createPool();
    pool = ctx.pool;
    await runMigrations(pool);
    clientsRepo = new ClientsRepository(pool);
    credsRepo = new ClientApiCredentialsRepository(pool);
    strategySecretsRepo = new ClientStrategySecretsRepository(pool);
    configService = new ClientConfigService(pool);
    process.env.CLIENT_MASTER_KEY = 'test-master-key';
  });

  afterEach(async () => {
    if (pool) {
      await pool.end();
    }
  });

  it('manages clients and credentials', async () => {
    await upsertClientRecord(clientsRepo, {
      id: 'client-a',
      name: 'Client A',
      owner: 'owner-a',
      plan: 'starter',
      status: 'active',
      contactInfo: { email: 'a@example.com' },
      limits: { guard: { maxGlobalDrawdownUsd: 100 } },
    });

    const clients = await fetchClients(clientsRepo);
    expect(clients.some((c) => c.id === 'client-a')).toBe(true);

    const snapshot = await fetchClientSnapshot(clientsRepo, credsRepo, 'client-a');
    expect(snapshot.client.name).toBe('Client A');
    expect(snapshot.credentials).toHaveLength(0);

    const stored = await storeClientCredentials(configService, {
      clientId: 'client-a',
      exchangeName: 'binance',
      apiKey: 'key-123',
      apiSecret: 'secret-xyz',
    });
    expect(stored.exchangeName).toBe('binance');

    const creds = await listClientCredentials(credsRepo, 'client-a');
    expect(creds).toHaveLength(1);
    expect(creds[0].hasPassphrase).toBe(false);

    await deleteClientCredentials(credsRepo, 'client-a', 'binance');
    const credsAfterDelete = await listClientCredentials(credsRepo, 'client-a');
    expect(credsAfterDelete).toHaveLength(0);

    const initialSecret = await fetchStrategySecretSummary(strategySecretsRepo, 'client-a', 'mev');
    expect(initialSecret.hasSecret).toBe(false);

    const wallet = ethers.Wallet.createRandom();
    await storeStrategySecretRecord(configService, {
      clientId: 'client-a',
      strategyId: 'mev',
      secret: wallet.privateKey,
      metadata: { address: wallet.address },
    });

    const storedSecret = await fetchStrategySecretSummary(strategySecretsRepo, 'client-a', 'mev');
    expect(storedSecret.hasSecret).toBe(true);
    expect(storedSecret.address).toBe(wallet.address);

    await deleteStrategySecretRecord(configService, 'client-a', 'mev');
    const afterDelete = await fetchStrategySecretSummary(strategySecretsRepo, 'client-a', 'mev');
    expect(afterDelete.hasSecret).toBe(false);
  });
});
