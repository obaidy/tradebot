import { Pool } from 'pg';

export interface UpsertBotPositionInput {
  botName: string;
  venue: string;
  symbol: string;
  direction: 'long' | 'short' | 'spot';
  qty: number;
  avgPrice: number;
  pnlRealized?: number | null;
  pnlUnrealized?: number | null;
  meta?: Record<string, unknown> | null;
  openedAt?: Date | null;
}

export interface UpdateBotPositionInput {
  botName: string;
  venue: string;
  symbol: string;
  qty?: number;
  avgPrice?: number;
  pnlRealized?: number;
  pnlUnrealized?: number;
  direction?: 'long' | 'short' | 'spot';
  meta?: Record<string, unknown> | null;
}

export interface BotPositionRecord {
  id: number;
  botName: string;
  venue: string;
  symbol: string;
  direction: 'long' | 'short' | 'spot';
  qty: number;
  avgPrice: number;
  pnlRealized: number;
  pnlUnrealized: number;
  meta: Record<string, unknown> | null;
  openedAt: Date;
  updatedAt: Date;
}

export class BotPositionsRepository {
  constructor(private readonly pool: Pool, private readonly clientId: string) {}

  async upsertPosition(input: UpsertBotPositionInput): Promise<BotPositionRecord> {
    const res = await this.pool.query(
      `INSERT INTO bot_positions (client_id, bot_name, venue, symbol, direction, qty, avg_price, pnl_realized, pnl_unrealized, meta, opened_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (client_id, bot_name, venue, symbol)
       DO UPDATE SET
         direction = EXCLUDED.direction,
         qty = EXCLUDED.qty,
         avg_price = EXCLUDED.avg_price,
         pnl_realized = EXCLUDED.pnl_realized,
         pnl_unrealized = EXCLUDED.pnl_unrealized,
         meta = COALESCE(EXCLUDED.meta, bot_positions.meta),
         opened_at = COALESCE(bot_positions.opened_at, EXCLUDED.opened_at),
         updated_at = NOW()
       RETURNING id, bot_name, venue, symbol, direction, qty, avg_price, pnl_realized, pnl_unrealized, meta, opened_at, updated_at`,
      [
        this.clientId,
        input.botName,
        input.venue,
        input.symbol,
        input.direction,
        input.qty,
        input.avgPrice,
        input.pnlRealized ?? 0,
        input.pnlUnrealized ?? 0,
        input.meta ?? null,
        input.openedAt ?? new Date(),
      ]
    );
    return this.mapRow(res.rows[0]);
  }

  async updatePosition(input: UpdateBotPositionInput): Promise<BotPositionRecord | null> {
    const fields: string[] = [];
    const params: unknown[] = [];
    if (input.direction) {
      fields.push(`direction = $${params.length + 5}`);
      params.push(input.direction);
    }
    if (input.qty !== undefined) {
      fields.push(`qty = $${params.length + 5}`);
      params.push(input.qty);
    }
    if (input.avgPrice !== undefined) {
      fields.push(`avg_price = $${params.length + 5}`);
      params.push(input.avgPrice);
    }
    if (input.pnlRealized !== undefined) {
      fields.push(`pnl_realized = $${params.length + 5}`);
      params.push(input.pnlRealized);
    }
    if (input.pnlUnrealized !== undefined) {
      fields.push(`pnl_unrealized = $${params.length + 5}`);
      params.push(input.pnlUnrealized);
    }
    if (input.meta !== undefined) {
      fields.push(`meta = $${params.length + 5}`);
      params.push(input.meta ?? null);
    }
    if (!fields.length) {
      return this.findPosition(input.botName, input.venue, input.symbol);
    }
    const res = await this.pool.query(
      `UPDATE bot_positions
       SET ${fields.join(', ')}, updated_at = NOW()
       WHERE client_id = $1 AND bot_name = $2 AND venue = $3 AND symbol = $4
       RETURNING id, bot_name, venue, symbol, direction, qty, avg_price, pnl_realized, pnl_unrealized, meta, opened_at, updated_at`,
      [this.clientId, input.botName, input.venue, input.symbol, ...params]
    );
    if (!res.rows.length) return null;
    return this.mapRow(res.rows[0]);
  }

  async deletePosition(botName: string, venue: string, symbol: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM bot_positions WHERE client_id = $1 AND bot_name = $2 AND venue = $3 AND symbol = $4`,
      [this.clientId, botName, venue, symbol]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async findPosition(botName: string, venue: string, symbol: string): Promise<BotPositionRecord | null> {
    const res = await this.pool.query(
      `SELECT id, bot_name, venue, symbol, direction, qty, avg_price, pnl_realized, pnl_unrealized, meta, opened_at, updated_at
       FROM bot_positions
       WHERE client_id = $1 AND bot_name = $2 AND venue = $3 AND symbol = $4`,
      [this.clientId, botName, venue, symbol]
    );
    if (!res.rows.length) return null;
    return this.mapRow(res.rows[0]);
  }

  async listOpen(botName?: string): Promise<BotPositionRecord[]> {
    const params: unknown[] = [this.clientId];
    const clauses = ['client_id = $1'];
    if (botName) {
      clauses.push(`bot_name = $${params.length + 1}`);
      params.push(botName);
    }
    const res = await this.pool.query(
      `SELECT id, bot_name, venue, symbol, direction, qty, avg_price, pnl_realized, pnl_unrealized, meta, opened_at, updated_at
       FROM bot_positions
       WHERE ${clauses.join(' AND ')}
       ORDER BY updated_at DESC`,
      params
    );
    return res.rows.map((row) => this.mapRow(row));
  }

  private mapRow(row: any): BotPositionRecord {
    return {
      id: Number(row.id),
      botName: row.bot_name,
      venue: row.venue,
      symbol: row.symbol,
      direction: row.direction,
      qty: Number(row.qty ?? 0),
      avgPrice: Number(row.avg_price ?? 0),
      pnlRealized: Number(row.pnl_realized ?? 0),
      pnlUnrealized: Number(row.pnl_unrealized ?? 0),
      meta: (row.meta as Record<string, unknown> | null) ?? null,
      openedAt: new Date(row.opened_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
