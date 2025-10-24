import { Pool } from 'pg';

export interface WhaleWatchlistRecord {
  id: number;
  chain: string;
  wallet: string;
  minLiquidityUsd: number;
  maxMcapUsd: number;
  blockedTokens: string[];
  notes: string | null;
  createdAt: Date;
}

export interface UpsertWhaleWatchlistInput {
  chain: string;
  wallet: string;
  minLiquidityUsd?: number;
  maxMcapUsd?: number;
  blockedTokens?: string[];
  notes?: string | null;
}

export class WhaleWatchlistRepository {
  constructor(private readonly pool: Pool, private readonly clientId: string) {}

  async upsert(entry: UpsertWhaleWatchlistInput): Promise<WhaleWatchlistRecord> {
    const res = await this.pool.query(
      `INSERT INTO whale_watchlist (client_id, chain, wallet, min_liquidity_usd, max_mcap_usd, blocked_tokens, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (client_id, chain, wallet)
       DO UPDATE SET
         min_liquidity_usd = EXCLUDED.min_liquidity_usd,
         max_mcap_usd = EXCLUDED.max_mcap_usd,
         blocked_tokens = EXCLUDED.blocked_tokens,
         notes = EXCLUDED.notes
       RETURNING id, chain, wallet, min_liquidity_usd, max_mcap_usd, blocked_tokens, notes, created_at`,
      [
        this.clientId,
        entry.chain.toLowerCase(),
        entry.wallet.toLowerCase(),
        entry.minLiquidityUsd ?? 30_000,
        entry.maxMcapUsd ?? 5_000_000,
        (entry.blockedTokens ?? []).map((token) => token.toLowerCase()),
        entry.notes ?? null,
      ]
    );
    return this.mapRow(res.rows[0]);
  }

  async remove(chain: string, wallet: string): Promise<boolean> {
    const res = await this.pool.query(
      `DELETE FROM whale_watchlist WHERE client_id = $1 AND chain = $2 AND wallet = $3`,
      [this.clientId, chain.toLowerCase(), wallet.toLowerCase()]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async list(): Promise<WhaleWatchlistRecord[]> {
    const res = await this.pool.query(
      `SELECT id, chain, wallet, min_liquidity_usd, max_mcap_usd, blocked_tokens, notes, created_at
       FROM whale_watchlist
       WHERE client_id = $1
       ORDER BY created_at DESC`,
      [this.clientId]
    );
    return res.rows.map((row) => this.mapRow(row));
  }

  async find(chain: string, wallet: string): Promise<WhaleWatchlistRecord | null> {
    const res = await this.pool.query(
      `SELECT id, chain, wallet, min_liquidity_usd, max_mcap_usd, blocked_tokens, notes, created_at
       FROM whale_watchlist
       WHERE client_id = $1 AND chain = $2 AND wallet = $3`,
      [this.clientId, chain.toLowerCase(), wallet.toLowerCase()]
    );
    if (!res.rows.length) return null;
    return this.mapRow(res.rows[0]);
  }

  private mapRow(row: any): WhaleWatchlistRecord {
    return {
      id: Number(row.id),
      chain: row.chain,
      wallet: row.wallet,
      minLiquidityUsd: Number(row.min_liquidity_usd ?? 0),
      maxMcapUsd: Number(row.max_mcap_usd ?? 0),
      blockedTokens: Array.isArray(row.blocked_tokens) ? row.blocked_tokens.map((token: string) => token) : [],
      notes: row.notes ?? null,
      createdAt: new Date(row.created_at),
    };
  }
}
