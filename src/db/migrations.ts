import { Pool } from 'pg';
import { PLAN_DEFINITIONS, buildPlanLimits } from '../config/plans';

const MIGRATION_QUERIES: string[] = [
  `CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'starter',
      status TEXT NOT NULL DEFAULT 'active',
      contact_info JSONB,
      limits_json JSONB,
      is_paused BOOLEAN NOT NULL DEFAULT FALSE,
      kill_requested BOOLEAN NOT NULL DEFAULT FALSE,
      billing_status TEXT NOT NULL DEFAULT 'trialing',
      trial_ends_at TIMESTAMPTZ,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      billing_auto_paused BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE TABLE IF NOT EXISTS client_api_credentials (
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      exchange_name TEXT NOT NULL,
      api_key_enc TEXT NOT NULL,
      api_secret_enc TEXT NOT NULL,
      passphrase_enc TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (client_id, exchange_name)
    );`,
  `CREATE TABLE IF NOT EXISTS client_strategy_secrets (
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      strategy_id TEXT NOT NULL,
      secret_enc TEXT NOT NULL,
      metadata_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (client_id, strategy_id)
    );`,
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
      ended_at TIMESTAMPTZ,
      CONSTRAINT fk_bot_runs_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );`,
  `CREATE TABLE IF NOT EXISTS bot_orders (
      id SERIAL PRIMARY KEY,
      run_id TEXT REFERENCES bot_runs(run_id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
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
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
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
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      base_asset TEXT NOT NULL,
      quote_asset TEXT NOT NULL,
      base_balance NUMERIC,
      quote_balance NUMERIC,
      exposure_usd NUMERIC,
      metadata JSONB,
      snapshot_time TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE TABLE IF NOT EXISTS bot_guard_state (
      client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
      global_pnl NUMERIC NOT NULL DEFAULT 0,
      run_pnl NUMERIC NOT NULL DEFAULT 0,
      inventory_base NUMERIC NOT NULL DEFAULT 0,
      inventory_cost NUMERIC NOT NULL DEFAULT 0,
      last_ticker_ts BIGINT,
      api_error_timestamps JSONB NOT NULL DEFAULT '[]'::jsonb
    );`,
  `CREATE TABLE IF NOT EXISTS client_audit_log (
      id SERIAL PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE INDEX IF NOT EXISTS idx_client_audit_client_created ON client_audit_log(client_id, created_at DESC);`,
  `CREATE TABLE IF NOT EXISTS client_workers (
      worker_id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'starting',
      last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE INDEX IF NOT EXISTS idx_client_workers_client ON client_workers(client_id);`,
  `CREATE TABLE IF NOT EXISTS client_terms_ack (
      id SERIAL PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      document_type TEXT NOT NULL,
      version TEXT NOT NULL,
      accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip_address TEXT
    );`,
  `CREATE INDEX IF NOT EXISTS idx_client_terms_ack_client_doc ON client_terms_ack(client_id, document_type);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_client_terms_ack ON client_terms_ack(client_id, document_type, version);`,
  `CREATE INDEX IF NOT EXISTS idx_bot_orders_run_status ON bot_orders(run_id, status);`,
  `CREATE INDEX IF NOT EXISTS idx_bot_orders_run_side ON bot_orders(run_id, side);`,
  `CREATE INDEX IF NOT EXISTS idx_bot_fills_run ON bot_fills(run_id);`,
  `CREATE INDEX IF NOT EXISTS idx_bot_fills_timestamp ON bot_fills(fill_timestamp DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_bot_runs_client_status ON bot_runs(client_id, status);`,
  `CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      org_id TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      subject TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      retention_expires_at TIMESTAMPTZ,
      metadata JSONB
    );`,
  `CREATE INDEX IF NOT EXISTS idx_chat_conversations_client ON chat_conversations(client_id);`,
  `CREATE INDEX IF NOT EXISTS idx_chat_conversations_status ON chat_conversations(status, last_message_at DESC);`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      sender_type TEXT NOT NULL,
      sender_id TEXT,
      body TEXT NOT NULL,
      metadata JSONB,
      sentiment JSONB,
      translation JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id, created_at);`,
  `CREATE TABLE IF NOT EXISTS chat_participants (
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      participant_id TEXT NOT NULL,
      participant_type TEXT NOT NULL,
      role TEXT,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      left_at TIMESTAMPTZ,
      PRIMARY KEY (conversation_id, participant_id, participant_type)
    );`,
  `CREATE INDEX IF NOT EXISTS idx_chat_participants_conversation ON chat_participants(conversation_id);`
];

const ranPools = new WeakSet<Pool>();

export async function runMigrations(pool: Pool) {
  if (ranPools.has(pool)) return;
  for (const query of MIGRATION_QUERIES) {
    await pool.query(query);
  }
  // evolve legacy schema: ensure columns exist with FK to clients
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_paused BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS kill_requested BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'trialing'`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`);
  await pool.query(`ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_auto_paused BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`ALTER TABLE bot_runs ADD COLUMN IF NOT EXISTS client_id TEXT`);
  await pool.query(`ALTER TABLE bot_orders ADD COLUMN IF NOT EXISTS client_id TEXT`);
  await pool.query(`ALTER TABLE bot_fills ADD COLUMN IF NOT EXISTS client_id TEXT`);
  await pool.query(`ALTER TABLE bot_inventory_snapshots ADD COLUMN IF NOT EXISTS client_id TEXT`);
  await pool.query(`ALTER TABLE bot_guard_state ADD COLUMN IF NOT EXISTS client_id TEXT`);
  await pool.query(`ALTER TABLE bot_guard_state DROP COLUMN IF EXISTS id`);

  await pool.query(`INSERT INTO clients (id, name, owner, plan, status) VALUES ('default', 'Default Client', 'system', 'starter', 'active') ON CONFLICT (id) DO NOTHING`);

  await pool.query(`UPDATE bot_runs SET client_id = 'default' WHERE client_id IS NULL`);
  await pool.query(`
    UPDATE bot_orders
    SET client_id = r.client_id
    FROM bot_runs r
    WHERE bot_orders.run_id = r.run_id AND (bot_orders.client_id IS NULL OR bot_orders.client_id <> r.client_id)
  `);
  await pool.query(`
    UPDATE bot_fills
    SET client_id = r.client_id
    FROM bot_runs r
    WHERE bot_fills.run_id = r.run_id AND (bot_fills.client_id IS NULL OR bot_fills.client_id <> r.client_id)
  `);
  await pool.query(`
    UPDATE bot_inventory_snapshots
    SET client_id = r.client_id
    FROM bot_runs r
    WHERE bot_inventory_snapshots.run_id = r.run_id AND (bot_inventory_snapshots.client_id IS NULL OR bot_inventory_snapshots.client_id <> r.client_id)
  `);
  await pool.query(`UPDATE bot_orders SET client_id = 'default' WHERE client_id IS NULL`);
  await pool.query(`UPDATE bot_fills SET client_id = 'default' WHERE client_id IS NULL`);
  await pool.query(`UPDATE bot_inventory_snapshots SET client_id = 'default' WHERE client_id IS NULL`);
  await pool.query(`UPDATE bot_guard_state SET client_id = 'default' WHERE client_id IS NULL`);

  await pool.query(`ALTER TABLE bot_runs ALTER COLUMN client_id SET NOT NULL`);
  await pool.query(`ALTER TABLE bot_orders ALTER COLUMN client_id SET NOT NULL`);
  await pool.query(`ALTER TABLE bot_fills ALTER COLUMN client_id SET NOT NULL`);
  await pool.query(`ALTER TABLE bot_inventory_snapshots ALTER COLUMN client_id SET NOT NULL`);
  await pool.query(`ALTER TABLE bot_guard_state ALTER COLUMN client_id SET NOT NULL`);

  const hasRunsFk = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'fk_bot_runs_client'`
  );
  if (hasRunsFk.rows.length === 0) {
    await pool.query(
      `ALTER TABLE bot_runs ADD CONSTRAINT fk_bot_runs_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE`
    );
  }

  const hasOldOrdersFk = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'fk_bot_orders_run_client'`
  );
  if (hasOldOrdersFk.rows.length) {
    await pool.query(`ALTER TABLE bot_orders DROP CONSTRAINT fk_bot_orders_run_client`);
  }
  const hasOrdersFk = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'fk_bot_orders_client'`
  );
  if (hasOrdersFk.rows.length === 0) {
    await pool.query(
      `ALTER TABLE bot_orders ADD CONSTRAINT fk_bot_orders_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE`
    );
  }

  const hasFillsFk = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'fk_bot_fills_client'`
  );
  if (hasFillsFk.rows.length === 0) {
    await pool.query(
      `ALTER TABLE bot_fills ADD CONSTRAINT fk_bot_fills_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE`
    );
  }

  const hasInventoryFk = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'fk_bot_inventory_client'`
  );
  if (hasInventoryFk.rows.length === 0) {
    await pool.query(
      `ALTER TABLE bot_inventory_snapshots ADD CONSTRAINT fk_bot_inventory_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE`
    );
  }
  const hasGuardFk = await pool.query(
    `SELECT 1 FROM pg_constraint WHERE conname = 'fk_bot_guard_state_client'`
  );
  if (hasGuardFk.rows.length === 0) {
    await pool.query(
      `ALTER TABLE bot_guard_state ADD CONSTRAINT fk_bot_guard_state_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE`
    );
  }

  await pool.query(`INSERT INTO bot_guard_state (client_id) VALUES ('default') ON CONFLICT (client_id) DO NOTHING`);

  const starterPlan = PLAN_DEFINITIONS.find((plan) => plan.id === 'starter');
  if (starterPlan) {
    const starterLimits = buildPlanLimits(starterPlan);
    await pool.query(
      `UPDATE clients
       SET limits_json = $1
       WHERE id = 'default'`,
      [starterLimits]
    );
  }

  ranPools.add(pool);
}
