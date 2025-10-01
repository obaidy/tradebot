import { Pool } from 'pg';
import type { StrategyId, StrategyRunMode } from '../strategies/types';

export interface ClientStrategyAllocationRow {
  clientId: string;
  strategyId: StrategyId;
  weightPct: number;
  maxRiskPct: number | null;
  runMode: StrategyRunMode | null;
  enabled: boolean;
  configJson: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertStrategyAllocationInput {
  clientId: string;
  strategyId: StrategyId;
  weightPct: number;
  maxRiskPct?: number | null;
  runMode?: StrategyRunMode | null;
  enabled?: boolean;
  config?: Record<string, unknown> | null;
}

export class ClientStrategyAllocationsRepository {
  constructor(private readonly pool: Pool) {}

  private mapRow(row: any): ClientStrategyAllocationRow {
    return {
      clientId: row.client_id,
      strategyId: row.strategy_id,
      weightPct: Number(row.weight_pct),
      maxRiskPct: row.max_risk_pct !== null ? Number(row.max_risk_pct) : null,
      runMode: row.run_mode ?? null,
      enabled: Boolean(row.enabled),
      configJson: row.config_json ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async listByClient(clientId: string): Promise<ClientStrategyAllocationRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM client_strategy_allocations WHERE client_id = $1 ORDER BY strategy_id`,
      [clientId]
    );
    return res.rows.map((row) => this.mapRow(row));
  }

  async upsert(input: UpsertStrategyAllocationInput): Promise<ClientStrategyAllocationRow> {
    const res = await this.pool.query(
      `INSERT INTO client_strategy_allocations (client_id, strategy_id, weight_pct, max_risk_pct, run_mode, enabled, config_json, updated_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, TRUE), $7, NOW())
       ON CONFLICT (client_id, strategy_id) DO UPDATE
       SET weight_pct = EXCLUDED.weight_pct,
           max_risk_pct = EXCLUDED.max_risk_pct,
           run_mode = EXCLUDED.run_mode,
           enabled = EXCLUDED.enabled,
           config_json = EXCLUDED.config_json,
           updated_at = NOW()
       RETURNING *`,
      [
        input.clientId,
        input.strategyId,
        input.weightPct,
        input.maxRiskPct ?? null,
        input.runMode ?? null,
        input.enabled ?? true,
        input.config ?? null,
      ]
    );
    return this.mapRow(res.rows[0]);
  }

  async delete(clientId: string, strategyId: StrategyId): Promise<void> {
    await this.pool.query(
      `DELETE FROM client_strategy_allocations WHERE client_id = $1 AND strategy_id = $2`,
      [clientId, strategyId]
    );
  }
}
