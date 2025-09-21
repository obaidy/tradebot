import { Pool } from 'pg';

export type WorkerStatus = 'starting' | 'running' | 'paused' | 'stopped' | 'error';

export interface ClientWorkerRecord {
  workerId: string;
  clientId: string;
  status: WorkerStatus;
  lastHeartbeat: Date;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export class ClientWorkersRepository {
  constructor(private readonly pool: Pool) {}

  async upsert(worker: {
    workerId: string;
    clientId: string;
    status: WorkerStatus;
    metadata?: Record<string, unknown> | null;
  }): Promise<ClientWorkerRecord> {
    const res = await this.pool.query(
      `INSERT INTO client_workers (worker_id, client_id, status, metadata, last_heartbeat)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (worker_id) DO UPDATE
       SET status = EXCLUDED.status,
           metadata = EXCLUDED.metadata,
           last_heartbeat = NOW()
       RETURNING worker_id, client_id, status, last_heartbeat, metadata, created_at`,
      [worker.workerId, worker.clientId, worker.status, worker.metadata ?? null]
    );
    return this.mapRow(res.rows[0]);
  }

  async heartbeat(workerId: string, status: WorkerStatus, metadata?: Record<string, unknown> | null) {
    const res = await this.pool.query(
      `UPDATE client_workers
       SET status = $2,
           metadata = $3,
           last_heartbeat = NOW()
       WHERE worker_id = $1
       RETURNING worker_id, client_id, status, last_heartbeat, metadata, created_at`,
      [workerId, status, metadata ?? null]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async remove(workerId: string) {
    await this.pool.query('DELETE FROM client_workers WHERE worker_id = $1', [workerId]);
  }

  async findByClient(clientId: string) {
    const res = await this.pool.query(
      `SELECT worker_id, client_id, status, last_heartbeat, metadata, created_at
       FROM client_workers WHERE client_id = $1`,
      [clientId]
    );
    return res.rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: any): ClientWorkerRecord {
    return {
      workerId: row.worker_id,
      clientId: row.client_id,
      status: row.status,
      lastHeartbeat: row.last_heartbeat,
      metadata: row.metadata ?? null,
      createdAt: row.created_at,
    };
  }
}
