import { Pool } from 'pg';

export interface AuditEntry {
  id: number;
  clientId: string;
  actor: string;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface CreateAuditEntryInput {
  clientId: string;
  actor: string;
  action: string;
  metadata?: Record<string, unknown> | null;
}

export class ClientAuditLogRepository {
  constructor(private readonly pool: Pool) {}

  async addEntry(input: CreateAuditEntryInput): Promise<AuditEntry> {
    const res = await this.pool.query(
      `INSERT INTO client_audit_log (client_id, actor, action, metadata)
       VALUES ($1,$2,$3,$4)
       RETURNING id, client_id, actor, action, metadata, created_at`,
      [input.clientId, input.actor, input.action, input.metadata ?? null]
    );
    const row = res.rows[0];
    return {
      id: row.id,
      clientId: row.client_id,
      actor: row.actor,
      action: row.action,
      metadata: row.metadata ?? null,
      createdAt: row.created_at,
    };
  }

  async getRecent(clientId: string, limit = 20): Promise<AuditEntry[]> {
    const res = await this.pool.query(
      `SELECT id, client_id, actor, action, metadata, created_at
       FROM client_audit_log
       WHERE client_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [clientId, limit]
    );
    return res.rows.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      actor: row.actor,
      action: row.action,
      metadata: row.metadata ?? null,
      createdAt: row.created_at,
    }));
  }
}
