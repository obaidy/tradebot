import { Pool } from 'pg';

const MIGRATION_QUERIES: string[] = [
  `CREATE TABLE IF NOT EXISTS bot_runs (
      run_id TEXT PRIMARY KEY,
      owner TEXT NOT NULL,
      client_id TEXT NOT NULL,
      exchange TEXT NOT NULL,
      params_json JSONB NOT NULL,
      rate_limit_meta JSONB,
      market_snapshot JSONB,
      status TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ
    );`,
  `CREATE TABLE IF NOT EXISTS bot_orders (
      id SERIAL PRIMARY KEY,
      run_id TEXT REFERENCES bot_runs(run_id) ON DELETE CASCADE,
      exchange_order_id TEXT,
      pair TEXT NOT NULL,
      side TEXT NOT NULL,
      price NUMERIC NOT NULL,
      amount NUMERIC NOT NULL,
      filled_amount NUMERIC NOT NULL DEFAULT 0,
      remaining_amount NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      correlation_id TEXT,
      drift_reason TEXT,
      raw JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE TABLE IF NOT EXISTS bot_fills (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES bot_orders(id) ON DELETE CASCADE,
      run_id TEXT REFERENCES bot_runs(run_id) ON DELETE CASCADE,
      pair TEXT NOT NULL,
      price NUMERIC NOT NULL,
      amount NUMERIC NOT NULL,
      fee NUMERIC,
      side TEXT NOT NULL,
      fill_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      raw JSONB
    );`,
  `CREATE TABLE IF NOT EXISTS bot_inventory_snapshots (
      id SERIAL PRIMARY KEY,
      run_id TEXT REFERENCES bot_runs(run_id) ON DELETE CASCADE,
      base_asset TEXT NOT NULL,
      quote_asset TEXT NOT NULL,
      base_balance NUMERIC,
      quote_balance NUMERIC,
      exposure_usd NUMERIC,
      metadata JSONB,
      snapshot_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE TABLE IF NOT EXISTS bot_guard_state (
      id INT PRIMARY KEY,
      global_pnl NUMERIC NOT NULL DEFAULT 0,
      run_pnl NUMERIC NOT NULL DEFAULT 0,
      inventory_base NUMERIC NOT NULL DEFAULT 0,
      inventory_cost NUMERIC NOT NULL DEFAULT 0,
      last_ticker_ts BIGINT,
      api_error_timestamps JSONB NOT NULL DEFAULT '[]'
    );`,
  `CREATE INDEX IF NOT EXISTS idx_bot_orders_run_status ON bot_orders(run_id, status);`,
  `CREATE INDEX IF NOT EXISTS idx_bot_fills_run ON bot_fills(run_id);`
];

const ranPools = new WeakSet<Pool>();

export async function runMigrations(pool: Pool) {
  if (ranPools.has(pool)) return;
  for (const query of MIGRATION_QUERIES) {
    await pool.query(query);
  }
  await pool.query(`INSERT INTO bot_guard_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  ranPools.add(pool);
}
