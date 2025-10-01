import { Pool } from 'pg';

export type GuardState = {
  globalPnl: number;
  runPnl: number;
  inventoryBase: number;
  inventoryCost: number;
  lastTickerTs: number;
  lastTickerRecordedAt: number;
  lastTickerSource: string | null;
  lastTickerLatencyMs: number | null;
  lastTickerSymbol: string | null;
  apiErrorTimestamps: number[];
};

const DEFAULT_STATE: GuardState = {
  globalPnl: 0,
  runPnl: 0,
  inventoryBase: 0,
  inventoryCost: 0,
  lastTickerTs: Date.now(),
  lastTickerRecordedAt: Date.now(),
  lastTickerSource: null,
  lastTickerLatencyMs: null,
  lastTickerSymbol: null,
  apiErrorTimestamps: [],
};

export class GuardStateRepository {
  constructor(private pool: Pool, private clientId: string) {}

  private async ensureRow() {
    await this.pool.query(
      `INSERT INTO bot_guard_state (client_id, global_pnl, run_pnl, inventory_base, inventory_cost, last_ticker_ts, api_error_timestamps)
       VALUES ($1, 0, 0, 0, 0, $2, '[]'::jsonb)
       ON CONFLICT (client_id) DO NOTHING`,
      [this.clientId, Date.now()]
    );
  }

  async load(): Promise<GuardState> {
    await this.ensureRow();
    const res = await this.pool.query('SELECT * FROM bot_guard_state WHERE client_id = $1', [this.clientId]);
    if (!res.rows.length) {
      return { ...DEFAULT_STATE };
    }
    const row = res.rows[0];
    return {
      globalPnl: Number(row.global_pnl || 0),
      runPnl: Number(row.run_pnl || 0),
      inventoryBase: Number(row.inventory_base || 0),
      inventoryCost: Number(row.inventory_cost || 0),
      lastTickerTs: Number(row.last_ticker_ts || Date.now()),
      lastTickerRecordedAt: Number(row.last_ticker_recorded_at || row.last_ticker_ts || Date.now()),
      lastTickerSource: row.last_ticker_source ?? null,
      lastTickerLatencyMs:
        row.last_ticker_latency_ms === null || row.last_ticker_latency_ms === undefined
          ? null
          : Number(row.last_ticker_latency_ms),
      lastTickerSymbol: row.last_ticker_symbol ?? null,
      apiErrorTimestamps: Array.isArray(row.api_error_timestamps)
        ? row.api_error_timestamps.map((n: any) => Number(n))
        : [],
    };
  }

  async save(state: GuardState) {
    await this.pool.query(
      `INSERT INTO bot_guard_state (client_id, global_pnl, run_pnl, inventory_base, inventory_cost, last_ticker_ts, api_error_timestamps, last_ticker_source, last_ticker_latency_ms, last_ticker_symbol, last_ticker_recorded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
       ON CONFLICT (client_id) DO UPDATE
       SET global_pnl = EXCLUDED.global_pnl,
           run_pnl = EXCLUDED.run_pnl,
           inventory_base = EXCLUDED.inventory_base,
           inventory_cost = EXCLUDED.inventory_cost,
           last_ticker_ts = EXCLUDED.last_ticker_ts,
           api_error_timestamps = EXCLUDED.api_error_timestamps,
           last_ticker_source = EXCLUDED.last_ticker_source,
           last_ticker_latency_ms = EXCLUDED.last_ticker_latency_ms,
           last_ticker_symbol = EXCLUDED.last_ticker_symbol,
           last_ticker_recorded_at = EXCLUDED.last_ticker_recorded_at`,
      [
        this.clientId,
        state.globalPnl,
        state.runPnl,
        state.inventoryBase,
        state.inventoryCost,
        state.lastTickerTs,
        JSON.stringify(state.apiErrorTimestamps),
        state.lastTickerSource,
        state.lastTickerLatencyMs,
        state.lastTickerSymbol,
        state.lastTickerRecordedAt,
      ]
    );
  }
}
