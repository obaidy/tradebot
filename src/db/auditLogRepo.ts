import { Pool } from 'pg';
import crypto from 'crypto';

export interface AuditEntry {
  id: number;
  clientId: string;
  actor: string;
  action: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  hash?: string | null;
  prevHash?: string | null;
}

export interface CreateAuditEntryInput {
  clientId: string;
  actor: string;
  action: string;
  metadata?: Record<string, unknown> | null;
}

export class ClientAuditLogRepository {
  constructor(private readonly pool: Pool) {}

  private async getLatestHash(clientId: string): Promise<string | null> {
    const res = await this.pool.query(
      `SELECT hash FROM client_audit_log WHERE client_id = $1 AND hash IS NOT NULL ORDER BY id DESC LIMIT 1`,
      [clientId]
    );
    return res.rows.length ? (res.rows[0].hash as string) : null;
  }

  async addEntry(input: CreateAuditEntryInput): Promise<AuditEntry> {
    const createdAt = new Date();
    const prevHash = await this.getLatestHash(input.clientId);
    const hashPayload = JSON.stringify({
      clientId: input.clientId,
      actor: input.actor,
      action: input.action,
      metadata: input.metadata ?? null,
      createdAt: createdAt.toISOString(),
    });
    const hash = crypto
      .createHash('sha256')
      .update((prevHash ?? '') + hashPayload)
      .digest('hex');

    const res = await this.pool.query(
      `INSERT INTO client_audit_log (client_id, actor, action, metadata, created_at, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id, client_id, actor, action, metadata, created_at, prev_hash, hash`,
      [input.clientId, input.actor, input.action, input.metadata ?? null, createdAt, prevHash, hash]
    );
    const row = res.rows[0];
    return {
      id: row.id,
      clientId: row.client_id,
      actor: row.actor,
      action: row.action,
      metadata: row.metadata ?? null,
      createdAt: row.created_at,
      prevHash: row.prev_hash ?? null,
      hash: row.hash ?? null,
    };
  }

  async getRecent(clientId: string, limit = 20): Promise<AuditEntry[]> {
    const res = await this.pool.query(
      `SELECT id, client_id, actor, action, metadata, created_at, prev_hash, hash
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
      prevHash: row.prev_hash ?? null,
      hash: row.hash ?? null,
    }));
  }

  async listHashesForDate(anchorDate: string): Promise<string[]> {
    const res = await this.pool.query(
      `SELECT hash FROM client_audit_log
       WHERE hash IS NOT NULL AND DATE(created_at) = $1
       ORDER BY id ASC`,
      [anchorDate]
    );
    return res.rows.map((row) => row.hash as string);
  }
}
