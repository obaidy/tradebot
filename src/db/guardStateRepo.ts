import { Pool } from 'pg';

export type GuardState = {
  globalPnl: number;
  runPnl: number;
  inventoryBase: number;
  inventoryCost: number;
  lastTickerTs: number;
  apiErrorTimestamps: number[];
};

const DEFAULT_STATE: GuardState = {
  globalPnl: 0,
  runPnl: 0,
  inventoryBase: 0,
  inventoryCost: 0,
  lastTickerTs: Date.now(),
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
      apiErrorTimestamps: Array.isArray(row.api_error_timestamps)
        ? row.api_error_timestamps.map((n: any) => Number(n))
        : [],
    };
  }

  async save(state: GuardState) {
    await this.pool.query(
      `INSERT INTO bot_guard_state (client_id, global_pnl, run_pnl, inventory_base, inventory_cost, last_ticker_ts, api_error_timestamps)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (client_id) DO UPDATE
       SET global_pnl = EXCLUDED.global_pnl,
           run_pnl = EXCLUDED.run_pnl,
           inventory_base = EXCLUDED.inventory_base,
           inventory_cost = EXCLUDED.inventory_cost,
           last_ticker_ts = EXCLUDED.last_ticker_ts,
           api_error_timestamps = EXCLUDED.api_error_timestamps`,
      [
        this.clientId,
        state.globalPnl,
        state.runPnl,
        state.inventoryBase,
        state.inventoryCost,
        state.lastTickerTs,
        JSON.stringify(state.apiErrorTimestamps),
      ]
    );
  }
}
