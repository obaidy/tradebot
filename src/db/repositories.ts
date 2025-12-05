import { Pool } from 'pg';

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface CreateRunInput {
  runId: string;
  owner: string;
  exchange: string;
  paramsJson: Record<string, unknown>;
  rateLimitMeta?: Record<string, unknown> | null;
  marketSnapshot?: Record<string, unknown> | null;
}

export interface UpdateRunStatusInput {
  runId: string;
  status: RunStatus;
  endedAt?: Date;
}

export interface InsertOrderInput {
  runId: string;
  exchangeOrderId?: string | null;
  pair: string;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  status: string;
  correlationId?: string;
  filledAmount?: number;
  remainingAmount?: number;
  raw?: Record<string, unknown> | null;
}

export interface UpdateOrderStatusInput {
  orderId: number;
  status: string;
  filledAmount?: number;
  remainingAmount?: number;
  driftReason?: string | null;
  raw?: Record<string, unknown> | null;
}

export interface InsertFillInput {
  orderId: number;
  runId: string;
  pair: string;
  price: number;
  amount: number;
  fee?: number | null;
  side: 'buy' | 'sell';
  fillTimestamp?: Date;
  raw?: Record<string, unknown> | null;
  clientBotId?: string | null;
}

export interface InventorySnapshotInput {
  runId: string;
  baseAsset: string;
  quoteAsset: string;
  baseBalance?: number | null;
  quoteBalance?: number | null;
  exposureUsd?: number | null;
  metadata?: Record<string, unknown> | null;
}

export class RunsRepository {
  constructor(private pool: Pool, private clientId: string) {}

  async createRun(input: CreateRunInput) {
    const res = await this.pool.query(
      `INSERT INTO bot_runs (run_id, owner, client_id, exchange, params_json, rate_limit_meta, market_snapshot, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'running')
       ON CONFLICT (run_id) DO UPDATE
       SET owner = EXCLUDED.owner,
           client_id = EXCLUDED.client_id,
           exchange = EXCLUDED.exchange,
           params_json = EXCLUDED.params_json,
           rate_limit_meta = EXCLUDED.rate_limit_meta,
           market_snapshot = EXCLUDED.market_snapshot,
           status = 'running',
           started_at = NOW(),
           ended_at = NULL
       RETURNING *`,
      [
        input.runId,
        input.owner,
        this.clientId,
        input.exchange,
        input.paramsJson,
        input.rateLimitMeta ?? null,
        input.marketSnapshot ?? null,
      ]
    );
    return res.rows[0];
  }

  async updateStatus({ runId, status, endedAt }: UpdateRunStatusInput) {
    const endedAtValue = endedAt ?? new Date();
    const res = await this.pool.query(
      `UPDATE bot_runs
       SET status = $2,
           ended_at = $3
       WHERE run_id = $1 AND client_id = $4
       RETURNING *`,
      [runId, status, endedAtValue, this.clientId]
    );
    return res.rows[0] ?? null;
  }

  async getActiveRuns() {
    const res = await this.pool.query(
      `SELECT * FROM bot_runs WHERE status = 'running' AND client_id = $1`,
      [this.clientId]
    );
    return res.rows;
  }

  async getActiveRunMetadata(): Promise<
    Array<{ runId: string; pair: string | null; plannedExposureUsd: number }>
  > {
    const res = await this.pool.query(
      `SELECT run_id, params_json, market_snapshot
       FROM bot_runs
       WHERE status = 'running' AND client_id = $1`,
      [this.clientId]
    );
    return res.rows.map((row) => {
      const params = (row.params_json ?? {}) as Record<string, any>;
      const snapshot = (row.market_snapshot ?? {}) as Record<string, any>;
      const pair =
        (typeof params.pair === 'string' && params.pair) ||
        (typeof params.symbol === 'string' && params.symbol) ||
        (typeof snapshot.pair === 'string' && snapshot.pair) ||
        null;
      const plannedExposureUsdRaw = (params as any).plannedExposureUsd;
      const plannedExposureUsd = Number(plannedExposureUsdRaw ?? 0);
      return {
        runId: row.run_id as string,
        pair,
        plannedExposureUsd: Number.isFinite(plannedExposureUsd) ? plannedExposureUsd : 0,
      };
    });
  }

  async getPlannedExposureSince(since: Date) {
    const res = await this.pool.query(
      `SELECT COALESCE(SUM((params_json->>'plannedExposureUsd')::numeric), 0) AS exposure
       FROM bot_runs
       WHERE client_id = $1
         AND started_at >= $2
         AND COALESCE(params_json->>'runMode', '') <> 'summary'`,
      [this.clientId, since.toISOString()]
    );
    const value = Number(res.rows[0]?.exposure ?? 0);
    return Number.isFinite(value) ? value : 0;
  }
}

export class OrdersRepository {
  constructor(private pool: Pool, private clientId: string) {}

  async insertOrder(input: InsertOrderInput) {
    const res = await this.pool.query(
      `INSERT INTO bot_orders
        (run_id, client_id, exchange_order_id, pair, side, price, amount, filled_amount, remaining_amount, status, correlation_id, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [
        input.runId,
        this.clientId,
        input.exchangeOrderId ?? null,
        input.pair,
        input.side,
        input.price,
        input.amount,
        input.filledAmount ?? 0,
        input.remainingAmount ?? input.amount,
        input.status,
        input.correlationId ?? null,
        input.raw ?? null,
      ]
    );
    return res.rows[0];
  }

  async updateOrder(input: UpdateOrderStatusInput) {
    const res = await this.pool.query(
      `UPDATE bot_orders
       SET status = $2,
           filled_amount = COALESCE($3, filled_amount),
           remaining_amount = COALESCE($4, remaining_amount),
           drift_reason = COALESCE($5, drift_reason),
           raw = COALESCE($6, raw),
           updated_at = NOW()
       WHERE id = $1 AND client_id = $7
       RETURNING *`,
      [
        input.orderId,
        input.status,
        input.filledAmount ?? null,
        input.remainingAmount ?? null,
        input.driftReason ?? null,
        input.raw ?? null,
        this.clientId,
      ]
    );
    return res.rows[0] ?? null;
  }

  async findByExchangeId(exchangeOrderId: string) {
    const res = await this.pool.query(
      `SELECT * FROM bot_orders WHERE exchange_order_id = $1 AND client_id = $2`,
      [exchangeOrderId, this.clientId]
    );
    return res.rows[0] ?? null;
  }

  async getOpenOrders() {
    const res = await this.pool.query(
      `SELECT * FROM bot_orders WHERE status IN ('placed','open','partial') AND client_id = $1`,
      [this.clientId]
    );
    return res.rows;
  }

  async getOpenOrdersForRun(runId: string, side?: 'buy' | 'sell') {
    if (side) {
      const res = await this.pool.query(
        `SELECT * FROM bot_orders
         WHERE run_id = $1 AND client_id = $3 AND side = $2 AND status IN ('placed','open','partial')`,
        [runId, side, this.clientId]
      );
      return res.rows;
    }
    const res = await this.pool.query(
      `SELECT * FROM bot_orders
       WHERE run_id = $1 AND client_id = $2 AND status IN ('placed','open','partial')`,
      [runId, this.clientId]
    );
    return res.rows;
  }
}

export class FillsRepository {
  constructor(private pool: Pool, private clientId: string) {}

  async insertFill(input: InsertFillInput) {
    const res = await this.pool.query(
      `INSERT INTO bot_fills (order_id, run_id, client_id, pair, price, amount, fee, side, fill_timestamp, raw, client_bot_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        input.orderId,
        input.runId,
        this.clientId,
        input.pair,
        input.price,
        input.amount,
        input.fee ?? null,
        input.side,
        input.fillTimestamp ?? new Date(),
        input.raw ?? null,
        input.clientBotId ?? null,
      ]
    );
    return res.rows[0];
  }
}

export class InventoryRepository {
  constructor(private pool: Pool, private clientId: string) {}

  async insertSnapshot(input: InventorySnapshotInput) {
    const res = await this.pool.query(
      `INSERT INTO bot_inventory_snapshots (run_id, client_id, base_asset, quote_asset, base_balance, quote_balance, exposure_usd, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        input.runId,
        this.clientId,
        input.baseAsset,
        input.quoteAsset,
        input.baseBalance ?? null,
        input.quoteBalance ?? null,
        input.exposureUsd ?? null,
        input.metadata ?? null,
      ]
    );
    return res.rows[0];
  }

  async getLatestSnapshots(): Promise<
    Array<{ baseAsset: string; quoteAsset: string; baseBalance: number; quoteBalance: number; exposureUsd: number }>
  > {
    const res = await this.pool.query(
      `SELECT DISTINCT ON (base_asset)
         base_asset,
         quote_asset,
         base_balance::float AS base_balance,
         quote_balance::float AS quote_balance,
         exposure_usd::float AS exposure_usd
       FROM bot_inventory_snapshots
       WHERE client_id = $1
       ORDER BY base_asset, snapshot_time DESC`,
      [this.clientId]
    );
    return res.rows.map((row) => ({
      baseAsset: row.base_asset,
      quoteAsset: row.quote_asset,
      baseBalance: Number(row.base_balance ?? 0) || 0,
      quoteBalance: Number(row.quote_balance ?? 0) || 0,
      exposureUsd: Number(row.exposure_usd ?? 0) || 0,
    }));
  }
}
