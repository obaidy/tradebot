import { Pool } from 'pg';

export interface PerformanceSummary {
  runCount: number;
  totalNetPnlUsd: number;
  avgNetPnlUsd: number;
  sharpeRatio: number | null;
  maxDrawdownUsd: number | null;
  winRate: number | null;
  avgHoldingHours: number | null;
}

export interface TradeExecutionStats {
  avgSlippageBps: number | null;
  medianSlippageBps: number | null;
  fillRatePct: number | null;
  avgFillDurationSec: number | null;
}

export interface MarketCorrelationEntry {
  assetA: string;
  assetB: string;
  correlation: number;
}

export interface AnalyticsSnapshot {
  performance: PerformanceSummary;
  execution: TradeExecutionStats;
  correlations: MarketCorrelationEntry[];
}

const DEFAULT_LOOKBACK_DAYS = 30;

export class PerformanceAnalyticsService {
  constructor(private readonly pool: Pool, private readonly clientId: string) {}

  async fetchAnalytics(params: { lookbackDays?: number } = {}): Promise<AnalyticsSnapshot> {
    const lookbackDays = params.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    const performance = await this.computePerformanceSummary(lookbackDays);
    const execution = await this.computeExecutionStats(lookbackDays);
    const correlations = await this.computeCorrelations(lookbackDays);
    return { performance, execution, correlations };
  }

  private async computePerformanceSummary(lookbackDays: number): Promise<PerformanceSummary> {
    const pnlRows = await this.pool.query<{
      net_pnl_usd: string;
      started_at: Date;
      ended_at: Date;
      run_id: string;
    }>(
      `SELECT run_id, (params_json->>'netPnlUsd')::numeric AS net_pnl_usd, started_at, ended_at
       FROM bot_runs
       WHERE client_id = $1
         AND status = 'completed'
         AND started_at >= NOW() - ($2::int * INTERVAL '1 day')
       ORDER BY started_at DESC
       LIMIT 200`,
      [this.clientId, lookbackDays]
    );

    if (!pnlRows.rows.length) {
      return {
        runCount: 0,
        totalNetPnlUsd: 0,
        avgNetPnlUsd: 0,
        sharpeRatio: null,
        maxDrawdownUsd: null,
        winRate: null,
        avgHoldingHours: null,
      };
    }

    const pnlSeries: number[] = [];
    let wins = 0;
    let holdingHoursSum = 0;
    for (const row of pnlRows.rows) {
      const pnl = Number(row.net_pnl_usd ?? 0);
      pnlSeries.push(pnl);
      if (pnl > 0) wins += 1;
      if (row.started_at && row.ended_at) {
        const dur = (row.ended_at.getTime() - row.started_at.getTime()) / (1000 * 60 * 60);
        if (Number.isFinite(dur)) {
          holdingHoursSum += dur;
        }
      }
    }

    const totalNetPnlUsd = pnlSeries.reduce((s, v) => s + v, 0);
    const avgNetPnlUsd = totalNetPnlUsd / pnlSeries.length;
    const winRate = pnlSeries.length ? wins / pnlSeries.length : null;

    const sharpeRatio = this.computeSharpe(pnlSeries);
    const maxDrawdownUsd = this.computeMaxDrawdown(pnlSeries);
    const avgHoldingHours = pnlSeries.length ? holdingHoursSum / pnlSeries.length : null;

    return {
      runCount: pnlSeries.length,
      totalNetPnlUsd,
      avgNetPnlUsd,
      sharpeRatio,
      maxDrawdownUsd,
      winRate,
      avgHoldingHours,
    };
  }

  private computeSharpe(pnlSeries: number[]): number | null {
    if (pnlSeries.length < 3) return null;
    const mean = pnlSeries.reduce((s, v) => s + v, 0) / pnlSeries.length;
    const variance = pnlSeries.reduce((s, v) => s + (v - mean) ** 2, 0) / (pnlSeries.length - 1);
    const stdDev = Math.sqrt(Math.max(variance, 0));
    if (stdDev === 0) return null;
    return mean / stdDev;
  }

  private computeMaxDrawdown(pnlSeries: number[]): number | null {
    if (!pnlSeries.length) return null;
    let cumulative = 0;
    let peak = 0;
    let maxDrawdown = 0;
    for (const pnl of pnlSeries) {
      cumulative += pnl;
      if (cumulative > peak) {
        peak = cumulative;
      }
      const drawdown = cumulative - peak;
      if (drawdown < maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }
    return maxDrawdown;
  }

  private async computeExecutionStats(lookbackDays: number): Promise<TradeExecutionStats> {
    const rows = await this.pool.query<{
      price: string;
      side: string;
      fills: any;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT price::float AS price,
              side,
              raw->'fills' AS fills,
              created_at,
              updated_at
       FROM bot_orders
       WHERE client_id = $1
         AND created_at >= NOW() - ($2::int * INTERVAL '1 day')
         AND status IN ('filled', 'partially_filled')
       ORDER BY created_at DESC
       LIMIT 500`,
      [this.clientId, lookbackDays]
    );

    if (!rows.rows.length) {
      return {
        avgSlippageBps: null,
        medianSlippageBps: null,
        fillRatePct: null,
        avgFillDurationSec: null,
      };
    }

    const slippageBps: number[] = [];
    let fillCompleted = 0;
    let totalFillDurationSec = 0;

    for (const row of rows.rows) {
      const fills = Array.isArray(row.fills) ? row.fills : [];
      if (fills.length === 0) continue;
      const orderPrice = Number(row.price);
      for (const fill of fills) {
        const fillPrice = Number(fill.price ?? orderPrice);
        if (!Number.isFinite(orderPrice) || !Number.isFinite(fillPrice) || orderPrice === 0) continue;
        const slippage = ((fillPrice - orderPrice) / orderPrice) * 10_000;
        slippageBps.push(slippage);
      }
      if (row.side && row.updated_at && row.created_at) {
        const durationSec = (row.updated_at.getTime() - row.created_at.getTime()) / 1000;
        if (Number.isFinite(durationSec)) {
          totalFillDurationSec += durationSec;
          fillCompleted += 1;
        }
      }
    }

    slippageBps.sort((a, b) => a - b);
    const avgSlippageBps = slippageBps.length
      ? slippageBps.reduce((s, v) => s + v, 0) / slippageBps.length
      : null;
    const medianSlippageBps = slippageBps.length
      ? slippageBps[Math.floor(slippageBps.length / 2)]
      : null;
    const fillRatePct = rows.rows.length ? (fillCompleted / rows.rows.length) * 100 : null;
    const avgFillDurationSec = fillCompleted ? totalFillDurationSec / fillCompleted : null;

    return {
      avgSlippageBps,
      medianSlippageBps,
      fillRatePct,
      avgFillDurationSec,
    };
  }

  private async computeCorrelations(lookbackDays: number): Promise<MarketCorrelationEntry[]> {
    const rows = await this.pool.query<{
      base_asset: string;
      quote_asset: string;
      exposure_usd: string;
    }>(
      `SELECT base_asset, quote_asset, exposure_usd::float AS exposure_usd
       FROM bot_inventory_snapshots
       WHERE client_id = $1
         AND snapshot_time >= NOW() - ($2::int * INTERVAL '1 day')
       ORDER BY snapshot_time DESC
       LIMIT 500`,
      [this.clientId, lookbackDays]
    );

    if (!rows.rows.length) return [];

    const exposuresByAsset = new Map<string, number[]>();
    for (const row of rows.rows) {
      const asset = row.base_asset?.toUpperCase?.() ?? row.base_asset;
      const exposure = Number(row.exposure_usd ?? 0) || 0;
      if (!exposuresByAsset.has(asset)) {
        exposuresByAsset.set(asset, []);
      }
      exposuresByAsset.get(asset)!.push(exposure);
    }

    const assets = Array.from(exposuresByAsset.keys());
    const correlations: MarketCorrelationEntry[] = [];
    for (let i = 0; i < assets.length; i += 1) {
      for (let j = i + 1; j < assets.length; j += 1) {
        const assetA = assets[i];
        const assetB = assets[j];
        const seriesA = exposuresByAsset.get(assetA) ?? [];
        const seriesB = exposuresByAsset.get(assetB) ?? [];
        if (seriesA.length < 3 || seriesB.length < 3) continue;
        const corr = this.computeCorrelation(seriesA, seriesB);
        if (corr !== null) {
          correlations.push({ assetA, assetB, correlation: corr });
        }
      }
    }
    return correlations;
  }

  private computeCorrelation(seriesA: number[], seriesB: number[]): number | null {
    const len = Math.min(seriesA.length, seriesB.length);
    if (len < 3) return null;
    const a = seriesA.slice(seriesA.length - len);
    const b = seriesB.slice(seriesB.length - len);
    const meanA = a.reduce((s, v) => s + v, 0) / len;
    const meanB = b.reduce((s, v) => s + v, 0) / len;

    let numerator = 0;
    let denomA = 0;
    let denomB = 0;
    for (let i = 0; i < len; i += 1) {
      const diffA = a[i] - meanA;
      const diffB = b[i] - meanB;
      numerator += diffA * diffB;
      denomA += diffA * diffA;
      denomB += diffB * diffB;
    }
    if (denomA === 0 || denomB === 0) return null;
    return numerator / Math.sqrt(denomA * denomB);
  }
}
