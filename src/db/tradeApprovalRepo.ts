import { Pool } from 'pg';

export type TradeApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface TradeApprovalRecord {
  id: number;
  correlationId: string | null;
  clientId: string;
  strategyId: string | null;
  tradeType: string;
  thresholdReason: string | null;
  amountUsd: number | null;
  status: TradeApprovalStatus;
  requestedBy: string;
  requestedAt: Date;
  approvedBy: string[] | null;
  approvedAt: Date | null;
  metadata: Record<string, unknown> | null;
}

export interface TradeApprovalCreateInput {
  correlationId?: string | null;
  clientId: string;
  strategyId?: string | null;
  tradeType: string;
  thresholdReason?: string | null;
  amountUsd?: number | null;
  requestedBy: string;
  metadata?: Record<string, unknown> | null;
}

export class TradeApprovalRepository {
  constructor(private readonly pool: Pool) {}

  private mapRow(row: any): TradeApprovalRecord {
    return {
      id: row.id,
      correlationId: row.correlation_id,
      clientId: row.client_id,
      strategyId: row.strategy_id,
      tradeType: row.trade_type,
      thresholdReason: row.threshold_reason,
      amountUsd: row.amount_usd ? Number(row.amount_usd) : null,
      status: row.status,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      approvedBy: row.approved_by ?? null,
      approvedAt: row.approved_at ?? null,
      metadata: row.metadata ?? null,
    };
  }

  async getByCorrelation(clientId: string, correlationId: string): Promise<TradeApprovalRecord | null> {
    const res = await this.pool.query(
      `SELECT * FROM trade_approvals
       WHERE client_id = $1 AND correlation_id = $2
       ORDER BY requested_at DESC
       LIMIT 1`,
      [clientId, correlationId]
    );
    if (!res.rows.length) return null;
    return this.mapRow(res.rows[0]);
  }

  async listByStatus(status: TradeApprovalStatus = 'pending', clientId?: string): Promise<TradeApprovalRecord[]> {
    const conditions: string[] = ['status = $1'];
    const params: any[] = [status];
    if (clientId) {
      conditions.push('client_id = $2');
      params.push(clientId);
    }
    const res = await this.pool.query(
      `SELECT * FROM trade_approvals
       WHERE ${conditions.join(' AND ')}
       ORDER BY requested_at DESC`,
      params
    );
    return res.rows.map((row) => this.mapRow(row));
  }

  async createPending(input: TradeApprovalCreateInput): Promise<TradeApprovalRecord> {
    const res = await this.pool.query(
      `INSERT INTO trade_approvals (correlation_id, client_id, strategy_id, trade_type, threshold_reason, amount_usd, status, requested_by, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8)
       RETURNING *`,
      [
        input.correlationId ?? null,
        input.clientId,
        input.strategyId ?? null,
        input.tradeType,
        input.thresholdReason ?? null,
        input.amountUsd ?? null,
        input.requestedBy,
        input.metadata ?? null,
      ]
    );
    return this.mapRow(res.rows[0]);
  }

  async markApproved(id: number, actor: string, metadataPatch?: Record<string, unknown>): Promise<TradeApprovalRecord> {
    const res = await this.pool.query(
      `UPDATE trade_approvals
       SET status = 'approved',
           approved_at = NOW(),
           approved_by = array_append(COALESCE(approved_by, ARRAY[]::text[]), $2),
           metadata = CASE WHEN $3::jsonb IS NULL THEN metadata ELSE COALESCE(metadata, '{}'::jsonb) || $3::jsonb END
       WHERE id = $1
       RETURNING *`,
      [id, actor, metadataPatch ? JSON.stringify(metadataPatch) : null]
    );
    if (!res.rows.length) {
      throw new Error(`Approval ${id} not found`);
    }
    return this.mapRow(res.rows[0]);
  }

  async markRejected(
    id: number,
    actor: string,
    metadataPatch?: Record<string, unknown>
  ): Promise<TradeApprovalRecord> {
    const res = await this.pool.query(
      `UPDATE trade_approvals
       SET status = 'rejected',
           approved_at = NOW(),
           approved_by = array_append(COALESCE(approved_by, ARRAY[]::text[]), $2),
           metadata = CASE WHEN $3::jsonb IS NULL THEN metadata ELSE COALESCE(metadata, '{}'::jsonb) || $3::jsonb END
       WHERE id = $1
       RETURNING *`,
      [id, actor, metadataPatch ? JSON.stringify(metadataPatch) : null]
    );
    if (!res.rows.length) {
      throw new Error(`Approval ${id} not found`);
    }
    return this.mapRow(res.rows[0]);
  }
}
