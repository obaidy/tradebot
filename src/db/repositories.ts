import { Pool } from 'pg';

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

export interface CreateRunInput {
  runId: string;
  owner: string;
  clientId: string;
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
  constructor(private pool: Pool) {}

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
        input.clientId,
        input.exchange,
        input.paramsJson,
        input.rateLimitMeta ?? null,
        input.marketSnapshot ?? null,
      ]
    );
    return res.rows[0];
  }

  async updateStatus({ runId, status, endedAt }: UpdateRunStatusInput) {
    const res = await this.pool.query(
      `UPDATE bot_runs
       SET status = $2,
           ended_at = CASE WHEN $3 IS NULL THEN ended_at ELSE $3 END
       WHERE run_id = $1
       RETURNING *`,
      [runId, status, endedAt ?? new Date()]
    );
    return res.rows[0] ?? null;
  }

  async getActiveRuns() {
    const res = await this.pool.query(`SELECT * FROM bot_runs WHERE status = 'running'`);
    return res.rows;
  }
}

export class OrdersRepository {
  constructor(private pool: Pool) {}

  async insertOrder(input: InsertOrderInput) {
    const res = await this.pool.query(
      `INSERT INTO bot_orders
        (run_id, exchange_order_id, pair, side, price, amount, filled_amount, remaining_amount, status, correlation_id, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        input.runId,
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
       WHERE id = $1
       RETURNING *`,
      [
        input.orderId,
        input.status,
        input.filledAmount ?? null,
        input.remainingAmount ?? null,
        input.driftReason ?? null,
        input.raw ?? null,
      ]
    );
    return res.rows[0] ?? null;
  }

  async findByExchangeId(exchangeOrderId: string) {
    const res = await this.pool.query(`SELECT * FROM bot_orders WHERE exchange_order_id = $1`, [exchangeOrderId]);
    return res.rows[0] ?? null;
  }

  async getOpenOrders() {
    const res = await this.pool.query(
      `SELECT * FROM bot_orders WHERE status IN ('placed','open','partial')`
    );
    return res.rows;
  }

  async getOpenOrdersForRun(runId: string, side?: 'buy' | 'sell') {
    if (side) {
      const res = await this.pool.query(
        `SELECT * FROM bot_orders WHERE run_id = $1 AND side = $2 AND status IN ('placed','open','partial')`,
        [runId, side]
      );
      return res.rows;
    }
    const res = await this.pool.query(
      `SELECT * FROM bot_orders WHERE run_id = $1 AND status IN ('placed','open','partial')`,
      [runId]
    );
    return res.rows;
  }
}

export class FillsRepository {
  constructor(private pool: Pool) {}

  async insertFill(input: InsertFillInput) {
    const res = await this.pool.query(
      `INSERT INTO bot_fills (order_id, run_id, pair, price, amount, fee, side, fill_timestamp, raw)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [
        input.orderId,
        input.runId,
        input.pair,
        input.price,
        input.amount,
        input.fee ?? null,
        input.side,
        input.fillTimestamp ?? new Date(),
        input.raw ?? null,
      ]
    );
    return res.rows[0];
  }
}

export class InventoryRepository {
  constructor(private pool: Pool) {}

  async insertSnapshot(input: InventorySnapshotInput) {
    const res = await this.pool.query(
      `INSERT INTO bot_inventory_snapshots (run_id, base_asset, quote_asset, base_balance, quote_balance, exposure_usd, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        input.runId,
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
}
