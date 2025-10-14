import { Pool } from 'pg';
import { promises as fs } from 'fs';
import path from 'path';
import { CONFIG } from '../config';

export type StrategyState = 'running' | 'paused' | 'error';
export type ActivityType = 'trade' | 'alert' | 'system';
export type ActivitySeverity = 'info' | 'warn' | 'critical';

export interface DashboardSummary {
  portfolio: {
    clientId: string;
    totalPnlUsd: number;
    dayChangePct: number;
    bankRollUsd: number;
    activeStrategies: number;
    updatedAt: string;
  };
  strategies: StrategyStatus[];
  risk: {
    globalDrawdownUsd: number;
    exposurePct: number;
    guardState: 'nominal' | 'warning' | 'critical';
  };
  quickActions: {
    killSwitchAvailable: boolean;
    pauseAllAvailable: boolean;
  };
}

export interface StrategyStatus {
  strategyId: string;
  name: string;
  runMode: 'live' | 'paper';
  status: StrategyState;
  pnlPct: number;
  lastRunAt: string;
}

export interface ActivityEntry {
  id: string;
  type: ActivityType;
  severity?: ActivitySeverity;
  title: string;
  description: string;
  asset?: string;
  pnlUsd?: number;
  createdAt: string;
}

export interface ActivityFeed {
  entries: ActivityEntry[];
  nextCursor?: string;
}

interface SampleDataShape {
  dashboard: DashboardSummary;
  activity: ActivityEntry[];
}

let cachedSampleData: SampleDataShape | null = null;

async function loadSampleData(): Promise<SampleDataShape | null> {
  if (cachedSampleData) return cachedSampleData;
  const samplePath = CONFIG.MOBILE.SAMPLE_DATA_PATH;
  if (!samplePath) return null;
  try {
    const resolved = path.isAbsolute(samplePath)
      ? samplePath
      : path.resolve(process.cwd(), samplePath);
    const raw = await fs.readFile(resolved, 'utf8');
    cachedSampleData = JSON.parse(raw) as SampleDataShape;
    return cachedSampleData;
  } catch (err) {
    if (CONFIG.ENV !== 'production') {
      console.warn('[mobile] sample data unavailable', err);
    }
    return null;
  }
}

interface OrderRow {
  id: number;
  created_at: Date;
  pair: string;
  side: string;
  price: number;
  amount: number;
  filled_amount: number;
  status: string;
  correlation_id?: string | null;
}

interface AuditRow {
  id: number;
  created_at: Date;
  action: string;
  actor: string;
  metadata: Record<string, unknown> | null;
}

interface StrategyAllocationRow {
  strategy_id: string;
  weight_pct: number;
  run_mode: string | null;
  enabled: boolean;
  updated_at: Date;
}

interface StrategyRunRow {
  strategy_id: string | null;
  status: string | null;
  started_at: Date | null;
  ended_at: Date | null;
  params_json: Record<string, unknown> | null;
  rate_limit_meta: Record<string, unknown> | null;
}

export async function fetchDashboardSummary(pool: Pool, clientId: string): Promise<DashboardSummary> {
  const sampleDataPromise = loadSampleData();
  const clientPromise = pool.query(
    `SELECT id, plan, is_paused, kill_requested FROM clients WHERE id = $1`,
    [clientId]
  );
  const guardPromise = pool.query(
    `SELECT global_pnl, run_pnl, inventory_base, inventory_cost, last_ticker_ts
     FROM bot_guard_state WHERE client_id = $1`,
    [clientId]
  );
  const strategyCountPromise = pool.query(
    `SELECT COUNT(*) as count FROM client_strategy_allocations WHERE client_id = $1 AND enabled = TRUE`,
    [clientId]
  );

  const [clientRes, guardRes, strategyCountRes] = await Promise.all([
    clientPromise,
    guardPromise,
    strategyCountPromise,
  ]);

  const clientRow = clientRes.rows[0] ?? null;
  const guardRow = guardRes.rows[0] ?? null;
  const activeStrategies = Number(strategyCountRes.rows[0]?.count ?? 0);

  const totalPnlUsd = guardRow ? Number(guardRow.global_pnl ?? 0) : 0;
  const runPnl = guardRow ? Number(guardRow.run_pnl ?? 0) : 0;
  const bankRollUsd = CONFIG.RISK.BANKROLL_USD ?? 0;
  const drawdown = totalPnlUsd < 0 ? Math.abs(totalPnlUsd) : 0;
  const exposureBase = guardRow ? Number(guardRow.inventory_base ?? 0) : 0;
  const exposurePct = bankRollUsd > 0 ? Math.min(Math.abs(exposureBase) / bankRollUsd, 1) * 100 : 0;

  const guardState = drawdown > bankRollUsd * 0.1 ? 'critical'
    : drawdown > bankRollUsd * 0.05 ? 'warning'
    : 'nominal';

  const sampleData = await sampleDataPromise;
  if (!clientRow && sampleData) {
    const dashboard = {
      ...sampleData.dashboard,
      portfolio: {
        ...sampleData.dashboard.portfolio,
        clientId,
        updatedAt: new Date().toISOString(),
      },
      strategies: sampleData.dashboard.strategies.map((strategy) => ({
        ...strategy,
        lastRunAt: strategy.lastRunAt ?? new Date().toISOString(),
      })),
    };
    return dashboard;
  }

  return {
    portfolio: {
      clientId,
      totalPnlUsd,
      dayChangePct: runPnl,
      bankRollUsd,
      activeStrategies,
      updatedAt: new Date().toISOString(),
    },
    strategies: await fetchStrategies(pool, clientId),
    risk: {
      globalDrawdownUsd: drawdown,
      exposurePct: Number(exposurePct.toFixed(2)),
      guardState,
    },
    quickActions: {
      killSwitchAvailable: clientRow ? !clientRow.kill_requested : true,
      pauseAllAvailable: clientRow ? !clientRow.is_paused : true,
    },
  };
}

export async function fetchStrategies(pool: Pool, clientId: string): Promise<StrategyStatus[]> {
  const allocationsPromise = pool.query<StrategyAllocationRow>(
    `SELECT strategy_id, weight_pct, run_mode, enabled, updated_at
     FROM client_strategy_allocations
     WHERE client_id = $1
     ORDER BY strategy_id`,
    [clientId]
  );
  const runsPromise = pool.query<StrategyRunRow>(
    `SELECT params_json, rate_limit_meta, status, started_at, ended_at,
            COALESCE(params_json->>'strategyId', params_json->>'strategy_id') AS strategy_id
     FROM bot_runs
     WHERE client_id = $1
     ORDER BY started_at DESC
     LIMIT 100`,
    [clientId]
  );

  const [allocationsRes, runsRes] = await Promise.all([allocationsPromise, runsPromise]);

  const latestRunByStrategy = new Map<string, StrategyRunRow>();
  for (const row of runsRes.rows) {
    const strategyId = (row as any).strategy_id as string | null;
    if (!strategyId) continue;
    if (!latestRunByStrategy.has(strategyId)) {
      latestRunByStrategy.set(strategyId, row);
    }
  }

  return allocationsRes.rows.map((row) => {
    const strategyId = row.strategy_id;
    const latestRun = latestRunByStrategy.get(strategyId) ?? null;
    const status = mapStrategyStatus(latestRun?.status ?? null, row.enabled);
    const pnlPct = latestRun?.rate_limit_meta && typeof latestRun.rate_limit_meta === 'object'
      ? Number((latestRun.rate_limit_meta as any).pnlPct ?? 0)
      : 0;
    const name = formatStrategyName(strategyId);
    const lastRunAt = latestRun?.ended_at ?? latestRun?.started_at ?? row.updated_at;
    return {
      strategyId,
      name,
      runMode: normalizeRunMode(row.run_mode),
      status,
      pnlPct: Number(pnlPct.toFixed(2)),
      lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : new Date(0).toISOString(),
    };
  });
}

export async function fetchActivityFeed(
  pool: Pool,
  clientId: string,
  options: { limit?: number; cursor?: string }
): Promise<ActivityFeed> {
  const sampleDataPromise = loadSampleData();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const cursorDate = options.cursor ? new Date(options.cursor) : null;
  if (cursorDate && Number.isNaN(cursorDate.getTime())) {
    throw new Error('invalid_cursor');
  }

  const orderParams: Array<string | Date> = [clientId];
  const auditParams: Array<string | Date> = [clientId];
  if (cursorDate) {
    orderParams.push(cursorDate);
    auditParams.push(cursorDate);
  }

  const orderQuery = `SELECT id, created_at, pair, side, price, amount, filled_amount, status, correlation_id
                      FROM bot_orders
                      WHERE client_id = $1
                      ${cursorDate ? 'AND created_at < $2' : ''}
                      ORDER BY created_at DESC
                      LIMIT ${limit}`;
  const auditQuery = `SELECT id, created_at, action, actor, metadata
                      FROM client_audit_log
                      WHERE client_id = $1
                      ${cursorDate ? 'AND created_at < $2' : ''}
                      ORDER BY created_at DESC
                      LIMIT ${limit}`;

  const [ordersRes, auditsRes] = await Promise.all([
    pool.query<OrderRow>(orderQuery, orderParams),
    pool.query<AuditRow>(auditQuery, auditParams),
  ]);

  const orderEntries = ordersRes.rows.map((row) => mapOrderToActivity(row));
  const auditEntries = auditsRes.rows.map((row) => mapAuditToActivity(row));
  const combined = [...orderEntries, ...auditEntries]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);

  const nextCursor = combined.length ? combined[combined.length - 1].createdAt : undefined;

  if (!combined.length) {
    const sampleData = await sampleDataPromise;
    if (sampleData) {
      return {
        entries: sampleData.activity.map((entry) => ({
          ...entry,
          createdAt: entry.createdAt ?? new Date().toISOString(),
        })),
        nextCursor: undefined,
      };
    }
  }

  return {
    entries: combined,
    nextCursor,
  };
}

export async function fetchRealtimeActivitySnapshot(pool: Pool, clientId: string): Promise<ActivityEntry[]> {
  const result = await fetchActivityFeed(pool, clientId, { limit: 20 });
  return result.entries;
}

function mapOrderToActivity(row: OrderRow): ActivityEntry {
  const severity: ActivitySeverity = row.status.toLowerCase().includes('fail')
    ? 'critical'
    : row.status.toLowerCase().includes('cancel')
    ? 'warn'
    : 'info';
  const filled = Number(row.filled_amount ?? 0);
  const price = Number(row.price ?? 0);
  const pnlUsd = filled && price ? Number((filled * price).toFixed(2)) : undefined;
  return {
    id: `order:${row.id}`,
    type: 'trade',
    severity,
    title: `${row.side.toUpperCase()} ${row.pair}`,
    description: `Status ${row.status}${row.correlation_id ? ` • ${row.correlation_id}` : ''}`,
    asset: row.pair,
    pnlUsd,
    createdAt: row.created_at.toISOString(),
  };
}

function mapAuditToActivity(row: AuditRow): ActivityEntry {
  return {
    id: `audit:${row.id}`,
    type: 'system',
    severity: 'info',
    title: row.action,
    description: row.actor,
    createdAt: row.created_at.toISOString(),
  };
}

function mapStrategyStatus(status: string | null, enabled: boolean): StrategyState {
  const normalized = (status ?? '').toLowerCase();
  if (!enabled) return 'paused';
  if (['failed', 'error', 'halted'].includes(normalized)) {
    return 'error';
  }
  if (['running', 'executing', 'active'].includes(normalized)) {
    return 'running';
  }
  return enabled ? 'running' : 'paused';
}

function normalizeRunMode(runMode: string | null): 'live' | 'paper' {
  const normalized = (runMode ?? '').toLowerCase();
  if (normalized === 'live') return 'live';
  return 'paper';
}

function formatStrategyName(strategyId: string): string {
  if (!strategyId) return 'Strategy';
  const spaced = strategyId
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, (_, a, b) => `${a} ${b}`)
    .replace(/\s+/g, ' ')
    .trim();
  return spaced
    .split(' ')
    .map((piece) => piece.charAt(0).toUpperCase() + piece.slice(1))
    .join(' ');
}
