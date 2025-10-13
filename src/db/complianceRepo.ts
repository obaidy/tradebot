import { Pool } from 'pg';

export interface ComplianceStatusRecord {
  clientId: string;
  provider: string | null;
  status: string;
  riskScore: number | null;
  referenceId: string | null;
  lastPayload: Record<string, unknown> | null;
  updatedAt: Date;
}

export interface UpsertComplianceInput {
  clientId: string;
  provider?: string | null;
  status: string;
  riskScore?: number | null;
  referenceId?: string | null;
  payload?: Record<string, unknown> | null;
}

export class ClientComplianceRepository {
  constructor(private readonly pool: Pool) {}

  private mapRow(row: any): ComplianceStatusRecord {
    return {
      clientId: row.client_id,
      provider: row.provider ?? null,
      status: row.status,
      riskScore: row.risk_score !== null ? Number(row.risk_score) : null,
      referenceId: row.reference_id ?? null,
      lastPayload: row.last_payload ?? null,
      updatedAt: row.updated_at,
    };
  }

  async getByClient(clientId: string): Promise<ComplianceStatusRecord | null> {
    const res = await this.pool.query(
      `SELECT * FROM client_compliance_status WHERE client_id = $1`,
      [clientId]
    );
    if (!res.rows.length) return null;
    return this.mapRow(res.rows[0]);
  }

  async upsert(input: UpsertComplianceInput): Promise<ComplianceStatusRecord> {
    const res = await this.pool.query(
      `INSERT INTO client_compliance_status (client_id, provider, status, risk_score, reference_id, last_payload, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (client_id)
       DO UPDATE SET
         provider = EXCLUDED.provider,
         status = EXCLUDED.status,
         risk_score = EXCLUDED.risk_score,
         reference_id = EXCLUDED.reference_id,
         last_payload = EXCLUDED.last_payload,
         updated_at = NOW()
       RETURNING *`,
      [
        input.clientId,
        input.provider ?? null,
        input.status,
        input.riskScore ?? null,
        input.referenceId ?? null,
        input.payload ?? null,
      ]
    );
    return this.mapRow(res.rows[0]);
  }
}
