import { Pool } from 'pg';
import { promises as fs } from 'fs';
import path from 'path';
import { CONFIG } from '../config';
import { listStrategies } from '../strategies';
import type { StrategySummary } from '../strategies/registry';
import type {
  ActivityEntry,
  ActivityFeedResponse,
  ActivitySeverity,
  ActivityType,
  ClientMetrics,
  DashboardSummaryResponse,
  MarketSnapshot,
  MarketWatchlist,
  StrategyDetail,
  StrategyRunMode,
  StrategyRunSummary,
  StrategyStatus,
  StrategyStatusState,
} from '../contracts/mobileApi';

interface SampleDataShape {
  dashboard: DashboardSummaryResponse;
  activity: ActivityEntry[];
  markets?: {
    snapshots?: MarketSnapshot[];
    watchlists?: MarketWatchlist[];
  };
}

let cachedSampleData: SampleDataShape | null = null;

function filterStrategiesByPlan(planId: string, registry: StrategySummary[]): StrategySummary[] {
  const normalized = planId.toLowerCase();
  return registry.filter((definition) =>
    definition.allowedPlans.some((allowed) => String(allowed).toLowerCase() === normalized)
  );
}

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
  id?: number | null;
  strategy_id: string | null;
  status: string | null;
  started_at: Date | null;
  ended_at: Date | null;
  params_json: Record<string, unknown> | null;
  rate_limit_meta: Record<string, unknown> | null;
}

export async function fetchDashboardSummary(
  pool: Pool,
  clientId: string
): Promise<DashboardSummaryResponse> {
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
  const clientPromise = pool.query(`SELECT plan FROM clients WHERE id = $1`, [clientId]);

  const [allocationsRes, runsRes, clientRes] = await Promise.all([allocationsPromise, runsPromise, clientPromise]);
  const sampleDataPromise = loadSampleData();

  const registry = listStrategies();
  const planId = (clientRes.rows[0]?.plan ?? 'starter').toString();
  const allowedDefinitionsRaw = filterStrategiesByPlan(planId, registry);
  const allowedDefinitions = allowedDefinitionsRaw.length ? allowedDefinitionsRaw : registry;

  const latestRunByStrategy = new Map<string, StrategyRunRow>();
  for (const row of runsRes.rows) {
    const strategyId = (row as any).strategy_id as string | null;
    if (!strategyId) continue;
    if (!latestRunByStrategy.has(strategyId)) {
      latestRunByStrategy.set(strategyId, row);
    }
  }

  const results: StrategyStatus[] = [];

  allocationsRes.rows.forEach((row) => {
    const definition = registry.find((item) => item.id === row.strategy_id) ?? null;
    const latestRun = latestRunByStrategy.get(row.strategy_id) ?? null;
    const status = mapStrategyStatus(latestRun?.status ?? null, row.enabled);
    const pnlPct = latestRun?.rate_limit_meta && typeof latestRun.rate_limit_meta === 'object'
      ? Number((latestRun.rate_limit_meta as any).pnlPct ?? 0)
      : 0;
    const lastRunAt = latestRun?.ended_at ?? latestRun?.started_at ?? row.updated_at;
    results.push({
      strategyId: row.strategy_id,
      name: definition ? definition.name : formatStrategyName(row.strategy_id),
      runMode: normalizeRunMode(row.run_mode),
      status,
      pnlPct: Number(pnlPct.toFixed(2)),
      lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : new Date(0).toISOString(),
      hasAllocation: true,
    });
  });

  const existingIds = new Set(results.map((item) => item.strategyId));

  allowedDefinitions
    .filter((definition) => !existingIds.has(definition.id))
    .forEach((definition) => {
      const latestRun = latestRunByStrategy.get(definition.id) ?? null;
      const pnlPct = latestRun?.rate_limit_meta && typeof latestRun.rate_limit_meta === 'object'
        ? Number((latestRun.rate_limit_meta as any).pnlPct ?? 0)
        : 0;
      const lastRunAt = latestRun?.ended_at ?? latestRun?.started_at ?? null;
      const defaultRunMode: StrategyRunMode = definition.supportsLive ? 'live' : 'paper';
      results.push({
        strategyId: definition.id,
        name: definition.name,
        runMode: defaultRunMode,
        status: 'paused',
        pnlPct: Number(pnlPct.toFixed(2)),
        lastRunAt: lastRunAt ? new Date(lastRunAt).toISOString() : new Date(0).toISOString(),
        hasAllocation: false,
      });
    });

  if (!results.length) {
    const sampleData = await sampleDataPromise;
    if (sampleData?.dashboard?.strategies?.length) {
      return sampleData.dashboard.strategies.map((strategy) => ({
        strategyId: strategy.strategyId,
        name: strategy.name,
        runMode: strategy.runMode,
        status: strategy.status,
        pnlPct: Number(strategy.pnlPct ?? 0),
        lastRunAt: strategy.lastRunAt ?? new Date().toISOString(),
      }));
    }
  }

  return results.sort((a, b) => a.strategyId.localeCompare(b.strategyId));
}

export async function fetchActivityFeed(
  pool: Pool,
  clientId: string,
  options: { limit?: number; cursor?: string }
): Promise<ActivityFeedResponse> {
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

export async function fetchMarketSnapshots(_pool: Pool, _clientId: string): Promise<MarketSnapshot[]> {
  const sampleData = await loadSampleData();
  if (sampleData?.markets?.snapshots?.length) {
    return sampleData.markets.snapshots.map((snapshot) => ({
      ...snapshot,
      updatedAt: snapshot.updatedAt ?? new Date().toISOString(),
    }));
  }
  return [];
}

export async function fetchDefaultWatchlists(): Promise<MarketWatchlist[]> {
  const sampleData = await loadSampleData();
  if (sampleData?.markets?.watchlists?.length) {
    return sampleData.markets.watchlists.map((watchlist) => ({
      ...watchlist,
      updatedAt: watchlist.updatedAt ?? new Date().toISOString(),
    }));
  }
  return [
    {
      id: 'core',
      name: 'Core Majors',
      symbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
      updatedAt: new Date().toISOString(),
    },
  ];
}

export async function fetchStrategyDetail(pool: Pool, clientId: string, strategyId: string): Promise<StrategyDetail | null> {
  const strategies = await fetchStrategies(pool, clientId);
  let base = strategies.find((item) => item.strategyId === strategyId) ?? null;

  if (!base) {
    const sampleData = await loadSampleData();
    const sampleStrategy = sampleData?.dashboard?.strategies?.find((item) => item.strategyId === strategyId);
    if (sampleStrategy) {
      base = sampleStrategy;
    }
  }

  if (!base) {
    return null;
  }

  const allocationRes = await pool.query<{ weight_pct: number | null; run_mode: string | null }>(
    `SELECT weight_pct, run_mode
     FROM client_strategy_allocations
     WHERE client_id = $1 AND strategy_id = $2
     LIMIT 1`,
    [clientId, strategyId]
  );
  const allocationRow = allocationRes.rows[0] ?? null;

  const runsRes = await pool.query<StrategyRunRow>(
    `SELECT id,
            COALESCE(params_json->>'strategyId', params_json->>'strategy_id') AS strategy_id,
            status,
            started_at,
            ended_at,
            params_json,
            rate_limit_meta
     FROM bot_runs
     WHERE client_id = $1
       AND (params_json->>'strategyId' = $2 OR params_json->>'strategy_id' = $2)
     ORDER BY started_at DESC
     LIMIT 20`,
    [clientId, strategyId]
  );

  const recentRuns: StrategyRunSummary[] = runsRes.rows.map((row) => {
    const rateMeta = (row.rate_limit_meta ?? {}) as Record<string, unknown>;
    const pnlPctValue = rateMeta?.pnlPct ?? rateMeta?.pnl ?? null;
    return {
      runId: row.strategy_id ? `${row.strategy_id}:${row.started_at?.getTime() ?? ''}` : String(row.id ?? ''),
      status: (row.status ?? 'unknown').toString(),
      startedAt: row.started_at ? row.started_at.toISOString() : null,
      endedAt: row.ended_at ? row.ended_at.toISOString() : null,
      pnlPct: typeof pnlPctValue === 'number' ? Number(pnlPctValue) : undefined,
      notes: typeof rateMeta?.note === 'string' ? (rateMeta.note as string) : undefined,
    };
  });

  const lastConfig = (runsRes.rows[0]?.params_json ?? null) as Record<string, unknown> | null;

  return {
    strategy: base,
    allocationPct: allocationRow?.weight_pct !== undefined && allocationRow?.weight_pct !== null ? Number(allocationRow.weight_pct) : null,
    allocationRunMode:
      allocationRow?.run_mode && allocationRow.run_mode.toLowerCase() === 'live' ? 'live' : base.runMode,
    recentRuns,
    lastConfig,
  };
}

export async function fetchRealtimeActivitySnapshot(pool: Pool, clientId: string): Promise<ActivityEntry[]> {
  const result = await fetchActivityFeed(pool, clientId, { limit: 20 });
  return result.entries;
}

export async function fetchClientMetricsSnapshot(pool: Pool, clientId: string): Promise<ClientMetrics | null> {
  const guardRes = await pool.query(
    'SELECT global_pnl, run_pnl, inventory_base, inventory_cost, last_ticker_ts FROM bot_guard_state WHERE client_id = $1',
    [clientId]
  );
  if (!guardRes.rows.length) {
    return null;
  }
  const row = guardRes.rows[0];
  const runRows = await pool.query(
    `SELECT params_json
     FROM bot_runs
     WHERE client_id = $1
     ORDER BY started_at DESC
     LIMIT 40`,
    [clientId]
  );
  const pnlHistory = runRows.rows
    .map((runRow) => {
      const params = (runRow.params_json ?? {}) as Record<string, any>;
      const summary = params.summary ?? params.plan?.summary ?? params.metadata?.summary ?? null;
      const candidate =
        summary?.estNetProfit ??
        summary?.raw?.estNetProfit ??
        params.summary?.raw?.estNetProfit ??
        params?.metrics?.estNetProfit ??
        null;
      return candidate !== null && candidate !== undefined ? Number(candidate) : null;
    })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  return {
    clientId,
    pnl: {
      global: Number(row.global_pnl || 0),
      run: Number(row.run_pnl || 0),
      history: pnlHistory,
    },
    inventory: {
      base: Number(row.inventory_base || 0),
      cost: Number(row.inventory_cost || 0),
    },
    lastTickerTs: row.last_ticker_ts ? Number(row.last_ticker_ts) : null,
  };
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

function mapStrategyStatus(status: string | null, enabled: boolean): StrategyStatusState {
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

function normalizeRunMode(runMode: string | null): StrategyRunMode {
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
