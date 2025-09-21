import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { Pool } from 'pg';
import { runMigrations } from '../src/db/migrations';
import { ClientsRepository } from '../src/db/clientsRepo';
import { ClientAgreementsRepository } from '../src/db/clientAgreementsRepo';

function createPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return { pool, db };
}

describe('ClientAgreementsRepository', () => {
  let pool: Pool;
  let repo: ClientAgreementsRepository;

  beforeEach(async () => {
    const ctx = createPool();
    pool = ctx.pool as unknown as Pool;
    await runMigrations(pool);
    const clientsRepo = new ClientsRepository(pool);
    await clientsRepo.upsert({ id: 'client-test', name: 'Client Test', owner: 'owner', plan: 'starter' });
    repo = new ClientAgreementsRepository(pool);
  });

  afterEach(async () => {
    if (pool) {
      await (pool as any).end();
    }
  });

  it('records and retrieves acknowledgements', async () => {
    await repo.recordAcceptance({
      clientId: 'client-test',
      documentType: 'tos',
      version: '2025-01-01',
      ipAddress: '127.0.0.1',
    });
    await repo.recordAcceptance({
      clientId: 'client-test',
      documentType: 'privacy',
      version: '2025-01-01',
    });

    const list = await repo.listByClient('client-test');
    expect(list).toHaveLength(2);

    const latest = await repo.getLatest('client-test', 'tos');
    expect(latest?.version).toBe('2025-01-01');
    expect(latest?.ipAddress).toBe('127.0.0.1');
  });
});
