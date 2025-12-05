import { randomUUID } from 'crypto';
import { Pool } from 'pg';

export type BotMode = 'paper' | 'live';
export type BotStatus = 'active' | 'paused' | 'stopped';

export interface ClientBotRow {
  id: string;
  clientId: string;
  templateKey: string;
  exchangeName: string;
  symbol: string;
  mode: BotMode;
  status: BotStatus;
  config: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateClientBotInput {
  id?: string;
  clientId: string;
  templateKey: string;
  exchangeName: string;
  symbol: string;
  mode: BotMode;
  status?: BotStatus;
  config?: Record<string, unknown> | null;
}

export interface UpdateClientBotInput {
  templateKey?: string;
  exchangeName?: string;
  symbol?: string;
  mode?: BotMode;
  status?: BotStatus;
  config?: Record<string, unknown> | null;
}

export class ClientBotsRepository {
  constructor(private readonly pool: Pool) {}

  private mapRow(row: any): ClientBotRow {
    return {
      id: row.id,
      clientId: row.client_id,
      templateKey: row.template_key,
      exchangeName: row.exchange_name,
      symbol: row.symbol,
      mode: row.mode,
      status: row.status,
      config: row.config_json ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listByClient(clientId: string): Promise<ClientBotRow[]> {
    const res = await this.pool.query('SELECT * FROM client_bots WHERE client_id = $1 ORDER BY created_at DESC', [
      clientId,
    ]);
    return res.rows.map((row) => this.mapRow(row));
  }

  async listActiveBots(): Promise<ClientBotRow[]> {
    const res = await this.pool.query("SELECT * FROM client_bots WHERE status = 'active' ORDER BY updated_at ASC");
    return res.rows.map((row) => this.mapRow(row));
  }

  async findById(botId: string): Promise<ClientBotRow | null> {
    const res = await this.pool.query('SELECT * FROM client_bots WHERE id = $1', [botId]);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async create(input: CreateClientBotInput): Promise<ClientBotRow> {
    const id = input.id ?? randomUUID();
    const res = await this.pool.query(
      `INSERT INTO client_bots (id, client_id, template_key, exchange_name, symbol, mode, status, config_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        id,
        input.clientId,
        input.templateKey,
        input.exchangeName,
        input.symbol,
        input.mode,
        input.status ?? 'active',
        input.config ?? null,
      ]
    );
    return this.mapRow(res.rows[0]);
  }

  async update(botId: string, patch: UpdateClientBotInput): Promise<ClientBotRow | null> {
    const existing = await this.findById(botId);
    if (!existing) return null;
    const nextConfig =
      patch.config !== undefined ? patch.config : existing.config;
    const res = await this.pool.query(
      `UPDATE client_bots
         SET template_key = COALESCE($2, template_key),
             exchange_name = COALESCE($3, exchange_name),
             symbol = COALESCE($4, symbol),
             mode = COALESCE($5, mode),
             status = COALESCE($6, status),
             config_json = $7,
             updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        botId,
        patch.templateKey ?? null,
        patch.exchangeName ?? null,
        patch.symbol ?? null,
        patch.mode ?? null,
        patch.status ?? null,
        nextConfig ?? null,
      ]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async delete(botId: string): Promise<void> {
    await this.pool.query('DELETE FROM client_bots WHERE id = $1', [botId]);
  }
}
