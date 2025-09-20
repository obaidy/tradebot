import { Pool } from 'pg';

function parseJsonValue<T = any>(value: any): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return null;
  }
}

export interface ClientRow {
  id: string;
  name: string;
  owner: string;
  plan: string;
  status: string;
  contactInfo: Record<string, unknown> | null;
  limits: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ClientUpsertInput {
  id: string;
  name: string;
  owner: string;
  plan?: string;
  status?: string;
  contactInfo?: Record<string, unknown> | null;
  limits?: Record<string, unknown> | null;
}

export class ClientsRepository {
  constructor(private readonly pool: Pool) {}

  async findById(clientId: string): Promise<ClientRow | null> {
    const res = await this.pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    if (!res.rows.length) {
      return null;
    }
    const row = res.rows[0];
    return {
      id: row.id,
      name: row.name,
      owner: row.owner,
      plan: row.plan,
      status: row.status,
      contactInfo: parseJsonValue(row.contact_info),
      limits: parseJsonValue(row.limits_json),
      createdAt: row.created_at,
    };
  }

  async listAll(): Promise<ClientRow[]> {
    const res = await this.pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    return res.rows.map((row) => ({
      id: row.id,
      name: row.name,
      owner: row.owner,
      plan: row.plan,
      status: row.status,
      contactInfo: parseJsonValue(row.contact_info),
      limits: parseJsonValue(row.limits_json),
      createdAt: row.created_at,
    }));
  }

  async upsert(input: ClientUpsertInput): Promise<ClientRow> {
    const res = await this.pool.query(
      `INSERT INTO clients (id, name, owner, plan, status, contact_info, limits_json)
       VALUES ($1,$2,$3,COALESCE($4,'starter'),COALESCE($5,'active'),$6,$7)
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           owner = EXCLUDED.owner,
           plan = EXCLUDED.plan,
           status = EXCLUDED.status,
           contact_info = EXCLUDED.contact_info,
           limits_json = EXCLUDED.limits_json
       RETURNING *`,
      [
        input.id,
        input.name,
        input.owner,
        input.plan ?? 'starter',
        input.status ?? 'active',
        input.contactInfo ?? null,
        input.limits ?? null,
      ]
    );
    return {
      id: res.rows[0].id,
      name: res.rows[0].name,
      owner: res.rows[0].owner,
      plan: res.rows[0].plan,
      status: res.rows[0].status,
      contactInfo: parseJsonValue(res.rows[0].contact_info),
      limits: parseJsonValue(res.rows[0].limits_json),
      createdAt: res.rows[0].created_at,
    };
  }
}

export interface ClientApiCredentialRow {
  clientId: string;
  exchangeName: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
  passphraseEnc: string | null;
  createdAt: Date;
}

export interface ClientApiCredentialUpsert {
  clientId: string;
  exchangeName: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
  passphraseEnc?: string | null;
}

export class ClientApiCredentialsRepository {
  constructor(private readonly pool: Pool) {}

  async getCredentials(clientId: string, exchangeName: string): Promise<ClientApiCredentialRow | null> {
    const res = await this.pool.query(
      `SELECT * FROM client_api_credentials WHERE client_id = $1 AND exchange_name = $2`,
      [clientId, exchangeName]
    );
    if (!res.rows.length) {
      return null;
    }
    const row = res.rows[0];
    return {
      clientId: row.client_id,
      exchangeName: row.exchange_name,
      apiKeyEnc: row.api_key_enc,
      apiSecretEnc: row.api_secret_enc,
      passphraseEnc: row.passphrase_enc,
      createdAt: row.created_at,
    };
  }

  async listByClient(clientId: string): Promise<ClientApiCredentialRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM client_api_credentials
       WHERE client_id = $1
       ORDER BY created_at DESC`,
      [clientId]
    );
    return res.rows.map((row) => ({
      clientId: row.client_id,
      exchangeName: row.exchange_name,
      apiKeyEnc: row.api_key_enc,
      apiSecretEnc: row.api_secret_enc,
      passphraseEnc: row.passphrase_enc,
      createdAt: row.created_at,
    }));
  }

  async upsert(input: ClientApiCredentialUpsert): Promise<ClientApiCredentialRow> {
    const res = await this.pool.query(
      `INSERT INTO client_api_credentials (client_id, exchange_name, api_key_enc, api_secret_enc, passphrase_enc)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (client_id, exchange_name) DO UPDATE
       SET api_key_enc = EXCLUDED.api_key_enc,
           api_secret_enc = EXCLUDED.api_secret_enc,
           passphrase_enc = EXCLUDED.passphrase_enc
       RETURNING *`,
      [
        input.clientId,
        input.exchangeName,
        input.apiKeyEnc,
        input.apiSecretEnc,
        input.passphraseEnc ?? null,
      ]
    );
    const row = res.rows[0];
    return {
      clientId: row.client_id,
      exchangeName: row.exchange_name,
      apiKeyEnc: row.api_key_enc,
      apiSecretEnc: row.api_secret_enc,
      passphraseEnc: row.passphrase_enc,
      createdAt: row.created_at,
    };
  }

  async delete(clientId: string, exchangeName: string) {
    await this.pool.query(`DELETE FROM client_api_credentials WHERE client_id = $1 AND exchange_name = $2`, [
      clientId,
      exchangeName,
    ]);
  }
}
