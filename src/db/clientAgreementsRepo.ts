import { Pool } from 'pg';

export interface ClientAgreementRow {
  id: number;
  clientId: string;
  documentType: string;
  version: string;
  acceptedAt: Date;
  ipAddress: string | null;
}

export class ClientAgreementsRepository {
  constructor(private readonly pool: Pool) {}

  async recordAcceptance(input: {
    clientId: string;
    documentType: string;
    version: string;
    ipAddress?: string | null;
  }): Promise<ClientAgreementRow> {
    const res = await this.pool.query(
      `INSERT INTO client_terms_ack (client_id, document_type, version, ip_address)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (client_id, document_type, version) DO UPDATE
       SET ip_address = COALESCE(EXCLUDED.ip_address, client_terms_ack.ip_address),
           accepted_at = NOW()
       RETURNING *`,
      [input.clientId, input.documentType, input.version, input.ipAddress ?? null]
    );
    return this.mapRow(res.rows[0]);
  }

  async listByClient(clientId: string): Promise<ClientAgreementRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM client_terms_ack
       WHERE client_id = $1
       ORDER BY accepted_at DESC`,
      [clientId]
    );
    return res.rows.map((row) => this.mapRow(row));
  }

  async getLatest(clientId: string, documentType: string): Promise<ClientAgreementRow | null> {
    const res = await this.pool.query(
      `SELECT * FROM client_terms_ack
       WHERE client_id = $1 AND document_type = $2
       ORDER BY accepted_at DESC
       LIMIT 1`,
      [clientId, documentType]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  private mapRow(row: any): ClientAgreementRow {
    return {
      id: row.id,
      clientId: row.client_id,
      documentType: row.document_type,
      version: row.version,
      acceptedAt: row.accepted_at,
      ipAddress: row.ip_address ?? null,
    };
  }
}
