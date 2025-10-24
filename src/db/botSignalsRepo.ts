import { Pool } from 'pg';

export interface CreateBotSignalInput {
  botName: string;
  signalType: string;
  strategyId?: string | null;
  symbol?: string | null;
  chain?: string | null;
  strength?: number | null;
  meta?: Record<string, unknown> | null;
}

export interface BotSignalRecord {
  id: number;
  botName: string;
  signalType: string;
  strategyId: string | null;
  symbol: string | null;
  chain: string | null;
  strength: number | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ListSignalsOptions {
  botName?: string;
  signalType?: string;
  limit?: number;
}

export class BotSignalsRepository {
  constructor(private readonly pool: Pool, private readonly clientId: string) {}

  async insert(input: CreateBotSignalInput): Promise<BotSignalRecord> {
    const res = await this.pool.query(
      `INSERT INTO bot_signals (client_id, bot_name, strategy_id, symbol, chain, signal_type, strength, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, bot_name, strategy_id, symbol, chain, signal_type, strength, meta, created_at`,
      [
        this.clientId,
        input.botName,
        input.strategyId ?? null,
        input.symbol ?? null,
        input.chain ?? null,
        input.signalType,
        input.strength ?? null,
        input.meta ?? null,
      ]
    );
    const row = res.rows[0];
    return {
      id: Number(row.id),
      botName: row.bot_name,
      signalType: row.signal_type,
      strategyId: row.strategy_id ?? null,
      symbol: row.symbol ?? null,
      chain: row.chain ?? null,
      strength: row.strength === null || row.strength === undefined ? null : Number(row.strength),
      meta: (row.meta as Record<string, unknown> | null) ?? null,
      createdAt: new Date(row.created_at),
    };
  }

  async listRecent(options: ListSignalsOptions = {}): Promise<BotSignalRecord[]> {
    const clauses = ['client_id = $1'];
    const params: unknown[] = [this.clientId];
    if (options.botName) {
      clauses.push('bot_name = $' + (params.length + 1));
      params.push(options.botName);
    }
    if (options.signalType) {
      clauses.push('signal_type = $' + (params.length + 1));
      params.push(options.signalType);
    }
    const limit = Number.isFinite(options.limit) && options.limit ? Math.min(Number(options.limit), 200) : 50;
    params.push(limit);
    const res = await this.pool.query(
      `SELECT id, bot_name, strategy_id, symbol, chain, signal_type, strength, meta, created_at
       FROM bot_signals
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    return res.rows.map((row) => ({
      id: Number(row.id),
      botName: row.bot_name,
      signalType: row.signal_type,
      strategyId: row.strategy_id ?? null,
      symbol: row.symbol ?? null,
      chain: row.chain ?? null,
      strength: row.strength === null || row.strength === undefined ? null : Number(row.strength),
      meta: (row.meta as Record<string, unknown> | null) ?? null,
      createdAt: new Date(row.created_at),
    }));
  }
}
