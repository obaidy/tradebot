import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { Pool } from 'pg';
import { runMigrations } from '../src/db/migrations';
import { ClientWorkersRepository } from '../src/db/clientWorkersRepo';
import { ClientsRepository } from '../src/db/clientsRepo';

function createPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return { pool, db };
}

describe('ClientWorkersRepository', () => {
  let pool: Pool;
  let repo: ClientWorkersRepository;

  beforeEach(async () => {
    const ctx = createPool();
    pool = ctx.pool as unknown as Pool;
    await runMigrations(pool);
    repo = new ClientWorkersRepository(pool);
    const clientsRepo = new ClientsRepository(pool);
    await clientsRepo.upsert({
      id: 'client-a',
      name: 'Client A',
      owner: 'owner-a',
      plan: 'starter',
    });
  });

  afterEach(async () => {
    if (pool) {
      await (pool as any).end();
    }
  });

  it('upserts and heartbeats worker state', async () => {
    await repo.upsert({ workerId: 'worker-1', clientId: 'client-a', status: 'starting' });
    const heartbeat = await repo.heartbeat('worker-1', 'running', { pid: 1234 });
    expect(heartbeat?.status).toBe('running');
    const workers = await repo.findByClient('client-a');
    expect(workers).toHaveLength(1);
    expect(workers[0].workerId).toBe('worker-1');
  });
});
