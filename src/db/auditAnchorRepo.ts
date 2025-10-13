import { Pool } from 'pg';

export interface AuditAnchorRecord {
  id: number;
  anchorDate: string;
  merkleRoot: string;
  createdAt: Date;
}

export class AuditAnchorRepository {
  constructor(private readonly pool: Pool) {}

  async insert(anchorDate: string, merkleRoot: string): Promise<AuditAnchorRecord> {
    const res = await this.pool.query(
      `INSERT INTO client_audit_anchors (anchor_date, merkle_root)
       VALUES ($1,$2)
       ON CONFLICT (anchor_date)
       DO UPDATE SET merkle_root = EXCLUDED.merkle_root, created_at = NOW()
       RETURNING id, anchor_date, merkle_root, created_at`,
      [anchorDate, merkleRoot]
    );
    const row = res.rows[0];
    return {
      id: row.id,
      anchorDate: row.anchor_date,
      merkleRoot: row.merkle_root,
      createdAt: row.created_at,
    };
  }

  async getLatest(): Promise<AuditAnchorRecord | null> {
    const res = await this.pool.query(
      `SELECT id, anchor_date, merkle_root, created_at
       FROM client_audit_anchors
       ORDER BY anchor_date DESC
       LIMIT 1`
    );
    if (!res.rows.length) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      anchorDate: row.anchor_date,
      merkleRoot: row.merkle_root,
      createdAt: row.created_at,
    };
  }
}
