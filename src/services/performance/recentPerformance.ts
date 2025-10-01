import { Pool } from 'pg';
import { logger } from '../../utils/logger';

export interface RecentPerformanceOptions {
  pair: string;
  maxRuns?: number;
  lookbackDays?: number;
}

export interface RecentPerformanceMetrics {
  runIds: string[];
  pnlSeries: number[];
  drawdowns: number[];
}

export class RecentPerformanceService {
  constructor(private readonly pool: Pool, private readonly clientId: string) {}

  async getRecentPerformance(options: RecentPerformanceOptions): Promise<RecentPerformanceMetrics | null> {
    const maxRuns = Math.max(1, options.maxRuns ?? 20);
    const lookbackDays = Math.max(1, options.lookbackDays ?? 30);
    try {
      const runRows = await this.pool.query<{
        run_id: string;
        started_at: Date;
      }>(
        `SELECT run_id, started_at
         FROM bot_runs
         WHERE client_id = $1
           AND COALESCE(params_json->>'pair', params_json->>'symbol') = $2
           AND started_at >= NOW() - ($3::int * INTERVAL '1 day')
           AND status IN ('completed', 'failed', 'cancelled')
         ORDER BY started_at DESC
         LIMIT $4`,
        [this.clientId, options.pair, lookbackDays, maxRuns]
      );

      if (!runRows.rows.length) {
        return null;
      }

      const runIdsDesc = runRows.rows.map((row) => row.run_id);
      const runIds = [...runIdsDesc].reverse();

      const fillRows = await this.pool.query<{
        run_id: string;
        side: string;
        price: number;
        amount: number;
        fee: number;
        fill_timestamp: Date;
      }>(
        `SELECT run_id, side, price::float AS price, amount::float AS amount, COALESCE(fee, 0)::float AS fee, fill_timestamp
         FROM bot_fills
         WHERE client_id = $1
           AND run_id = ANY($2::text[])
         ORDER BY fill_timestamp ASC`,
        [this.clientId, runIds]
      );

      const map = new Map<string, { revenue: number; cost: number }>();
      runIds.forEach((id) => map.set(id, { revenue: 0, cost: 0 }));

      for (const row of fillRows.rows) {
        const bucket = map.get(row.run_id);
        if (!bucket) continue;
        const gross = Number(row.price) * Number(row.amount);
        const fee = Number(row.fee) || 0;
        if (row.side === 'sell') {
          bucket.revenue += gross - fee;
        } else {
          bucket.cost += gross + fee;
        }
      }

      const pnlSeries = runIds.map((runId) => {
        const bucket = map.get(runId);
        if (!bucket) return 0;
        return bucket.revenue - bucket.cost;
      });

      const drawdowns = this.computeDrawdowns(pnlSeries);

      return { runIds, pnlSeries, drawdowns };
    } catch (error) {
      logger.warn('recent_performance_fetch_failed', {
        event: 'recent_performance_fetch_failed',
        pair: options.pair,
        clientId: this.clientId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private computeDrawdowns(pnlSeries: number[]): number[] {
    const drawdowns: number[] = [];
    let cumulative = 0;
    let peak = 0;
    for (const pnl of pnlSeries) {
      cumulative += pnl;
      if (cumulative > peak) {
        peak = cumulative;
      }
      const drawdown = cumulative - peak;
      drawdowns.push(drawdown);
    }
    return drawdowns;
  }
}
