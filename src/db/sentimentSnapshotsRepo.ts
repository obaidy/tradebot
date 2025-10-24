import { Pool } from 'pg';

export interface InsertSentimentSnapshotInput {
  token: string;
  mentions5m: number;
  mentions30m: number;
  trendingScore: number;
  liquidityUsd?: number | null;
  dexVolume5m?: number | null;
  meta?: Record<string, unknown> | null;
}

export interface SentimentSnapshotRecord {
  id: number;
  token: string;
  mentions5m: number;
  mentions30m: number;
  trendingScore: number;
  liquidityUsd: number | null;
  dexVolume5m: number | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
}

export class SentimentSnapshotsRepository {
  constructor(private readonly pool: Pool, private readonly clientId: string) {}

  async insert(input: InsertSentimentSnapshotInput): Promise<SentimentSnapshotRecord> {
    const res = await this.pool.query(
      `INSERT INTO sentiment_snapshots (client_id, token, mentions_5m, mentions_30m, trending_score, liquidity_usd, dex_volume_5m, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, token, mentions_5m, mentions_30m, trending_score, liquidity_usd, dex_volume_5m, meta, created_at`,
      [
        this.clientId,
        input.token.toLowerCase(),
        input.mentions5m,
        input.mentions30m,
        input.trendingScore,
        input.liquidityUsd ?? null,
        input.dexVolume5m ?? null,
        input.meta ?? null,
      ]
    );
    return this.mapRow(res.rows[0]);
  }

  async listRecent(limit = 50): Promise<SentimentSnapshotRecord[]> {
    const capped = Math.min(Math.max(limit, 1), 200);
    const res = await this.pool.query(
      `SELECT id, token, mentions_5m, mentions_30m, trending_score, liquidity_usd, dex_volume_5m, meta, created_at
       FROM sentiment_snapshots
       WHERE client_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [this.clientId, capped]
    );
    return res.rows.map((row) => this.mapRow(row));
  }

  async latestByToken(token: string): Promise<SentimentSnapshotRecord | null> {
    const res = await this.pool.query(
      `SELECT id, token, mentions_5m, mentions_30m, trending_score, liquidity_usd, dex_volume_5m, meta, created_at
       FROM sentiment_snapshots
       WHERE client_id = $1 AND token = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [this.clientId, token.toLowerCase()]
    );
    if (!res.rows.length) return null;
    return this.mapRow(res.rows[0]);
  }

  private mapRow(row: any): SentimentSnapshotRecord {
    return {
      id: Number(row.id),
      token: row.token,
      mentions5m: Number(row.mentions_5m ?? 0),
      mentions30m: Number(row.mentions_30m ?? 0),
      trendingScore: Number(row.trending_score ?? 0),
      liquidityUsd: row.liquidity_usd === null || row.liquidity_usd === undefined ? null : Number(row.liquidity_usd),
      dexVolume5m: row.dex_volume_5m === null || row.dex_volume_5m === undefined ? null : Number(row.dex_volume_5m),
      meta: (row.meta as Record<string, unknown> | null) ?? null,
      createdAt: new Date(row.created_at),
    };
  }
}
