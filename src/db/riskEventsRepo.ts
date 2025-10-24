import { Pool } from 'pg';

export interface CreateRiskEventInput {
  type: string;
  severity: number;
  details?: Record<string, unknown> | null;
}

export interface RiskEventRecord {
  id: number;
  type: string;
  severity: number;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

export class RiskEventsRepository {
  constructor(private readonly pool: Pool, private readonly clientId: string) {}

  async insert(input: CreateRiskEventInput): Promise<RiskEventRecord> {
    const severity = Number.isFinite(input.severity) ? Number(input.severity) : 1;
    const res = await this.pool.query(
      `INSERT INTO risk_events (client_id, type, severity, details)
       VALUES ($1,$2,$3,$4)
       RETURNING id, type, severity, details, created_at`,
      [this.clientId, input.type, severity, input.details ?? null]
    );
    const row = res.rows[0];
    return {
      id: Number(row.id),
      type: row.type,
      severity: Number(row.severity ?? 0),
      details: (row.details as Record<string, unknown> | null) ?? null,
      createdAt: new Date(row.created_at),
    };
  }

  async latestByType(type: string): Promise<RiskEventRecord | null> {
    const res = await this.pool.query(
      `SELECT id, type, severity, details, created_at
       FROM risk_events
       WHERE client_id = $1 AND type = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [this.clientId, type]
    );
    if (!res.rows.length) return null;
    const row = res.rows[0];
    return {
      id: Number(row.id),
      type: row.type,
      severity: Number(row.severity ?? 0),
      details: (row.details as Record<string, unknown> | null) ?? null,
      createdAt: new Date(row.created_at),
    };
  }

  async listRecent(limit = 100): Promise<RiskEventRecord[]> {
    const capped = Math.min(Math.max(limit, 1), 300);
    const res = await this.pool.query(
      `SELECT id, type, severity, details, created_at
       FROM risk_events
       WHERE client_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [this.clientId, capped]
    );
    return res.rows.map((row) => ({
      id: Number(row.id),
      type: row.type,
      severity: Number(row.severity ?? 0),
      details: (row.details as Record<string, unknown> | null) ?? null,
      createdAt: new Date(row.created_at),
    }));
  }
}
