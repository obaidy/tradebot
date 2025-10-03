import { Pool } from 'pg';
import type { StrategyId } from '../strategies/types';

export type StrategyListingVisibility = 'public' | 'private' | 'unlisted';
export type StrategyListingStatus = 'draft' | 'active' | 'archived';

export interface StrategyListingRow {
  id: string;
  clientId: string;
  strategyId: StrategyId | string;
  title: string;
  description: string | null;
  config: Record<string, unknown> | null;
  visibility: StrategyListingVisibility;
  status: StrategyListingStatus;
  tags: string[];
  pricing: Record<string, unknown> | null;
  performance: Record<string, unknown> | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateStrategyListingInput {
  id: string;
  clientId: string;
  strategyId: StrategyId | string;
  title: string;
  description?: string;
  config?: Record<string, unknown> | null;
  visibility?: StrategyListingVisibility;
  tags?: string[];
  pricing?: Record<string, unknown> | null;
}

export interface UpdateStrategyListingInput {
  title?: string;
  description?: string | null;
  config?: Record<string, unknown> | null;
  visibility?: StrategyListingVisibility;
  status?: StrategyListingStatus;
  tags?: string[] | null;
  pricing?: Record<string, unknown> | null;
  performance?: Record<string, unknown> | null;
  publishedAt?: Date | null;
}

export interface StrategyFollowerRow {
  id: string;
  listingId: string;
  followerClientId: string;
  allocationPct: number | null;
  settings: Record<string, unknown> | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertFollowerInput {
  id: string;
  listingId: string;
  followerClientId: string;
  allocationPct?: number | null;
  settings?: Record<string, unknown> | null;
  status?: string;
}

export interface StrategyStatsRow {
  listingId: string;
  totalFollowers: number;
  totalPnlUsd: number;
  sharpeRatio: number | null;
  winRate: number | null;
  maxDrawdownUsd: number | null;
  updatedAt: Date;
}

export interface UpsertStrategyStatsInput {
  listingId: string;
  totalFollowers?: number;
  totalPnlUsd?: number;
  sharpeRatio?: number | null;
  winRate?: number | null;
  maxDrawdownUsd?: number | null;
}

export interface TournamentRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  startsAt: Date | null;
  endsAt: Date | null;
  prizePoolUsd: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TournamentEntryRow {
  id: string;
  tournamentId: string;
  listingId: string | null;
  clientId: string;
  status: string;
  pnlUsd: number | null;
  sharpeRatio: number | null;
  rank: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export class StrategyMarketplaceRepository {
  constructor(private readonly pool: Pool) {}

  private mapListing(row: any): StrategyListingRow {
    return {
      id: row.id,
      clientId: row.client_id,
      strategyId: row.strategy_id,
      title: row.title,
      description: row.description ?? null,
      config: row.config_json ?? null,
      visibility: row.visibility,
      status: row.status,
      tags: Array.isArray(row.tags) ? row.tags : [],
      pricing: row.pricing_json ?? null,
      performance: row.performance_json ?? null,
      publishedAt: row.published_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async create(input: CreateStrategyListingInput): Promise<StrategyListingRow> {
    const res = await this.pool.query(
      `INSERT INTO social_strategy_listings (id, client_id, strategy_id, title, description, config_json, visibility, tags, pricing_json, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,'public'),COALESCE($8, ARRAY[]::text[]),$9,NOW(),NOW())
       RETURNING *`,
      [
        input.id,
        input.clientId,
        input.strategyId,
        input.title,
        input.description ?? null,
        input.config ?? null,
        input.visibility ?? 'public',
        input.tags ?? [],
        input.pricing ?? null,
      ]
    );
    return this.mapListing(res.rows[0]);
  }

  async update(id: string, input: UpdateStrategyListingInput): Promise<StrategyListingRow | null> {
    const res = await this.pool.query(
      `UPDATE social_strategy_listings
       SET title = COALESCE($2, title),
           description = COALESCE($3, description),
           config_json = COALESCE($4, config_json),
           visibility = COALESCE($5, visibility),
           status = COALESCE($6, status),
           tags = COALESCE($7, tags),
           pricing_json = COALESCE($8, pricing_json),
           performance_json = COALESCE($9, performance_json),
           published_at = COALESCE($10, published_at),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        input.title ?? null,
        input.description ?? null,
        input.config ?? null,
        input.visibility ?? null,
        input.status ?? null,
        input.tags ?? null,
        input.pricing ?? null,
        input.performance ?? null,
        input.publishedAt ?? null,
      ]
    );
    if (!res.rows.length) return null;
    return this.mapListing(res.rows[0]);
  }

  async publish(id: string): Promise<StrategyListingRow | null> {
    const res = await this.pool.query(
      `UPDATE social_strategy_listings
       SET status = 'active',
           published_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );
    if (!res.rows.length) return null;
    return this.mapListing(res.rows[0]);
  }

  async archive(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE social_strategy_listings
       SET status = 'archived', updated_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }

  async remove(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM social_strategy_listings WHERE id = $1`, [id]);
  }

  async get(id: string): Promise<StrategyListingRow | null> {
    const res = await this.pool.query(`SELECT * FROM social_strategy_listings WHERE id = $1`, [id]);
    if (!res.rows.length) return null;
    return this.mapListing(res.rows[0]);
  }

  async listPublic(): Promise<StrategyListingRow[]> {
    const res = await this.pool.query(
      `SELECT *
       FROM social_strategy_listings
       WHERE visibility = 'public' AND status = 'active'
       ORDER BY COALESCE(published_at, created_at) DESC
       LIMIT 200`
    );
    return res.rows.map((row) => this.mapListing(row));
  }

  async listByOwner(clientId: string): Promise<StrategyListingRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM social_strategy_listings WHERE client_id = $1 ORDER BY created_at DESC`,
      [clientId]
    );
    return res.rows.map((row) => this.mapListing(row));
  }
}

export class StrategyFollowersRepository {
  constructor(private readonly pool: Pool) {}

  private mapFollower(row: any): StrategyFollowerRow {
    return {
      id: row.id,
      listingId: row.listing_id,
      followerClientId: row.follower_client_id,
      allocationPct: row.allocation_pct !== null ? Number(row.allocation_pct) : null,
      settings: row.settings_json ?? null,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async upsert(input: UpsertFollowerInput): Promise<StrategyFollowerRow> {
    const res = await this.pool.query(
      `INSERT INTO social_strategy_followers (id, listing_id, follower_client_id, allocation_pct, settings_json, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,'active'),NOW(),NOW())
       ON CONFLICT (listing_id, follower_client_id) DO UPDATE
       SET allocation_pct = COALESCE(EXCLUDED.allocation_pct, social_strategy_followers.allocation_pct),
           settings_json = COALESCE(EXCLUDED.settings_json, social_strategy_followers.settings_json),
           status = COALESCE(EXCLUDED.status, social_strategy_followers.status),
           updated_at = NOW()
       RETURNING *`,
      [
        input.id,
        input.listingId,
        input.followerClientId,
        input.allocationPct ?? null,
        input.settings ?? null,
        input.status ?? 'active',
      ]
    );
    return this.mapFollower(res.rows[0]);
  }

  async delete(listingId: string, followerId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM social_strategy_followers WHERE listing_id = $1 AND follower_client_id = $2`,
      [listingId, followerId]
    );
  }

  async listFollowers(listingId: string): Promise<StrategyFollowerRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM social_strategy_followers WHERE listing_id = $1 ORDER BY created_at DESC`,
      [listingId]
    );
    return res.rows.map((row) => this.mapFollower(row));
  }

  async listFollowing(clientId: string): Promise<StrategyFollowerRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM social_strategy_followers WHERE follower_client_id = $1 ORDER BY updated_at DESC`,
      [clientId]
    );
    return res.rows.map((row) => this.mapFollower(row));
  }
}

export class StrategyStatsRepository {
  constructor(private readonly pool: Pool) {}

  private mapStats(row: any): StrategyStatsRow {
    return {
      listingId: row.listing_id,
      totalFollowers: Number(row.total_followers || 0),
      totalPnlUsd: Number(row.total_pnl_usd || 0),
      sharpeRatio: row.sharpe_ratio !== null ? Number(row.sharpe_ratio) : null,
      winRate: row.win_rate !== null ? Number(row.win_rate) : null,
      maxDrawdownUsd: row.max_drawdown_usd !== null ? Number(row.max_drawdown_usd) : null,
      updatedAt: row.updated_at,
    };
  }

  async upsert(input: UpsertStrategyStatsInput): Promise<StrategyStatsRow> {
    const res = await this.pool.query(
      `INSERT INTO social_strategy_stats (listing_id, total_followers, total_pnl_usd, sharpe_ratio, win_rate, max_drawdown_usd, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (listing_id) DO UPDATE
       SET total_followers = COALESCE(EXCLUDED.total_followers, social_strategy_stats.total_followers),
           total_pnl_usd = COALESCE(EXCLUDED.total_pnl_usd, social_strategy_stats.total_pnl_usd),
           sharpe_ratio = COALESCE(EXCLUDED.sharpe_ratio, social_strategy_stats.sharpe_ratio),
           win_rate = COALESCE(EXCLUDED.win_rate, social_strategy_stats.win_rate),
           max_drawdown_usd = COALESCE(EXCLUDED.max_drawdown_usd, social_strategy_stats.max_drawdown_usd),
           updated_at = NOW()
       RETURNING *`,
      [
        input.listingId,
        input.totalFollowers ?? 0,
        input.totalPnlUsd ?? 0,
        input.sharpeRatio ?? null,
        input.winRate ?? null,
        input.maxDrawdownUsd ?? null,
      ]
    );
    return this.mapStats(res.rows[0]);
  }

  async get(listingId: string): Promise<StrategyStatsRow | null> {
    const res = await this.pool.query(`SELECT * FROM social_strategy_stats WHERE listing_id = $1`, [listingId]);
    if (!res.rows.length) return null;
    return this.mapStats(res.rows[0]);
  }

  async leaderboard(limit = 20): Promise<StrategyStatsRow[]> {
    const res = await this.pool.query(
      `SELECT *
       FROM social_strategy_stats
       ORDER BY total_pnl_usd DESC NULLS LAST, total_followers DESC NULLS LAST
       LIMIT $1`,
      [limit]
    );
    return res.rows.map((row) => this.mapStats(row));
  }
}

export class TournamentsRepository {
  constructor(private readonly pool: Pool) {}

  private mapTournament(row: any): TournamentRow {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      status: row.status,
      startsAt: row.starts_at ?? null,
      endsAt: row.ends_at ?? null,
      prizePoolUsd: row.prize_pool_usd !== null ? Number(row.prize_pool_usd) : null,
      metadata: row.metadata ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapEntry(row: any): TournamentEntryRow {
    return {
      id: row.id,
      tournamentId: row.tournament_id,
      listingId: row.listing_id ?? null,
      clientId: row.client_id,
      status: row.status,
      pnlUsd: row.pnl_usd !== null ? Number(row.pnl_usd) : null,
      sharpeRatio: row.sharpe_ratio !== null ? Number(row.sharpe_ratio) : null,
      rank: row.rank !== null ? Number(row.rank) : null,
      metadata: row.metadata ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async createTournament(tournament: TournamentRow): Promise<TournamentRow> {
    const res = await this.pool.query(
      `INSERT INTO social_tournaments (id, name, description, status, starts_at, ends_at, prize_pool_usd, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
       RETURNING *`,
      [
        tournament.id,
        tournament.name,
        tournament.description ?? null,
        tournament.status,
        tournament.startsAt ?? null,
        tournament.endsAt ?? null,
        tournament.prizePoolUsd ?? null,
        tournament.metadata ?? null,
      ]
    );
    return this.mapTournament(res.rows[0]);
  }

  async updateTournament(id: string, patch: Partial<Omit<TournamentRow, 'id' | 'createdAt' | 'updatedAt'>>): Promise<TournamentRow | null> {
    const res = await this.pool.query(
      `UPDATE social_tournaments
       SET name = COALESCE($2, name),
           description = COALESCE($3, description),
           status = COALESCE($4, status),
           starts_at = COALESCE($5, starts_at),
           ends_at = COALESCE($6, ends_at),
           prize_pool_usd = COALESCE($7, prize_pool_usd),
           metadata = COALESCE($8, metadata),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id,
        patch.name ?? null,
        patch.description ?? null,
        patch.status ?? null,
        patch.startsAt ?? null,
        patch.endsAt ?? null,
        patch.prizePoolUsd ?? null,
        patch.metadata ?? null,
      ]
    );
    if (!res.rows.length) return null;
    return this.mapTournament(res.rows[0]);
  }

  async getTournament(id: string): Promise<TournamentRow | null> {
    const res = await this.pool.query(`SELECT * FROM social_tournaments WHERE id = $1`, [id]);
    if (!res.rows.length) return null;
    return this.mapTournament(res.rows[0]);
  }

  async listTournaments(): Promise<TournamentRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM social_tournaments ORDER BY starts_at NULLS FIRST, created_at DESC`
    );
    return res.rows.map((row) => this.mapTournament(row));
  }

  async upsertEntry(entry: TournamentEntryRow): Promise<TournamentEntryRow> {
    const res = await this.pool.query(
      `INSERT INTO social_tournament_entries (id, tournament_id, listing_id, client_id, status, pnl_usd, sharpe_ratio, rank, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
       ON CONFLICT (id) DO UPDATE
       SET status = EXCLUDED.status,
           pnl_usd = EXCLUDED.pnl_usd,
           sharpe_ratio = EXCLUDED.sharpe_ratio,
           rank = EXCLUDED.rank,
           metadata = EXCLUDED.metadata,
           updated_at = NOW()
       RETURNING *`,
      [
        entry.id,
        entry.tournamentId,
        entry.listingId ?? null,
        entry.clientId,
        entry.status,
        entry.pnlUsd ?? null,
        entry.sharpeRatio ?? null,
        entry.rank ?? null,
        entry.metadata ?? null,
      ]
    );
    return this.mapEntry(res.rows[0]);
  }

  async listEntries(tournamentId: string): Promise<TournamentEntryRow[]> {
    const res = await this.pool.query(
      `SELECT *
       FROM social_tournament_entries
       WHERE tournament_id = $1
       ORDER BY COALESCE(rank, 999999) ASC, created_at ASC`,
      [tournamentId]
    );
    return res.rows.map((row) => this.mapEntry(row));
  }
}
