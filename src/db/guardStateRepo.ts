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
  constructor(private pool: Pool) {}

  async load(): Promise<GuardState> {
    const res = await this.pool.query('SELECT * FROM bot_guard_state WHERE id = 1');
    if (!res.rows.length) {
      await this.pool.query('INSERT INTO bot_guard_state (id) VALUES (1)');
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
      `UPDATE bot_guard_state
       SET global_pnl = $2,
           run_pnl = $3,
           inventory_base = $4,
           inventory_cost = $5,
           last_ticker_ts = $6,
           api_error_timestamps = $7
       WHERE id = $1`,
      [
        1,
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
