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
  `CREATE TABLE IF NOT EXISTS client_strategy_allocations (
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      strategy_id TEXT NOT NULL,
      weight_pct NUMERIC NOT NULL,
      max_risk_pct NUMERIC,
      run_mode TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      config_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (client_id, strategy_id)
    );`,
  `CREATE INDEX IF NOT EXISTS idx_client_strategy_allocations_client ON client_strategy_allocations(client_id);`,
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
  `ALTER TABLE client_audit_log ADD COLUMN IF NOT EXISTS prev_hash TEXT;`,
  `ALTER TABLE client_audit_log ADD COLUMN IF NOT EXISTS hash TEXT;`,
  `CREATE TABLE IF NOT EXISTS client_audit_anchors (
      id SERIAL PRIMARY KEY,
      anchor_date DATE NOT NULL,
      merkle_root TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(anchor_date)
    );`,
  `CREATE TABLE IF NOT EXISTS client_compliance_status (
      client_id TEXT PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
      provider TEXT,
      status TEXT NOT NULL,
      risk_score NUMERIC,
      reference_id TEXT,
      last_payload JSONB,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE TABLE IF NOT EXISTS trade_approvals (
      id SERIAL PRIMARY KEY,
      correlation_id TEXT,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      strategy_id TEXT,
      trade_type TEXT NOT NULL,
      threshold_reason TEXT,
      amount_usd NUMERIC,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by TEXT NOT NULL,
      requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      approved_by TEXT[],
      approved_at TIMESTAMPTZ,
      metadata JSONB
    );`,
  `CREATE INDEX IF NOT EXISTS idx_trade_approvals_client_status ON trade_approvals(client_id, status);`,
  `CREATE INDEX IF NOT EXISTS idx_trade_approvals_correlation ON trade_approvals(correlation_id);`,
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
  `CREATE INDEX IF NOT EXISTS idx_chat_participants_conversation ON chat_participants(conversation_id);`,
  `CREATE TABLE IF NOT EXISTS social_strategy_listings (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      strategy_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      config_json JSONB,
      visibility TEXT NOT NULL DEFAULT 'public',
      status TEXT NOT NULL DEFAULT 'draft',
      tags TEXT[] DEFAULT ARRAY[]::text[],
      pricing_json JSONB,
      performance_json JSONB,
      published_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE INDEX IF NOT EXISTS idx_social_strategy_listings_client ON social_strategy_listings(client_id);`,
  `CREATE INDEX IF NOT EXISTS idx_social_strategy_listings_visibility ON social_strategy_listings(visibility, status);`,
  `CREATE TABLE IF NOT EXISTS social_strategy_followers (
      id TEXT PRIMARY KEY,
      listing_id TEXT NOT NULL REFERENCES social_strategy_listings(id) ON DELETE CASCADE,
      follower_client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      allocation_pct NUMERIC,
      settings_json JSONB,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (listing_id, follower_client_id)
    );`,
  `CREATE INDEX IF NOT EXISTS idx_social_strategy_followers_listing ON social_strategy_followers(listing_id);`,
  `CREATE INDEX IF NOT EXISTS idx_social_strategy_followers_follower ON social_strategy_followers(follower_client_id);`,
  `CREATE TABLE IF NOT EXISTS social_strategy_stats (
      listing_id TEXT PRIMARY KEY REFERENCES social_strategy_listings(id) ON DELETE CASCADE,
      total_followers INTEGER NOT NULL DEFAULT 0,
      total_pnl_usd NUMERIC NOT NULL DEFAULT 0,
      sharpe_ratio NUMERIC,
      win_rate NUMERIC,
      max_drawdown_usd NUMERIC,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE TABLE IF NOT EXISTS social_tournaments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'upcoming',
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      prize_pool_usd NUMERIC,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE TABLE IF NOT EXISTS social_tournament_entries (
      id TEXT PRIMARY KEY,
      tournament_id TEXT NOT NULL REFERENCES social_tournaments(id) ON DELETE CASCADE,
      listing_id TEXT REFERENCES social_strategy_listings(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'registered',
      pnl_usd NUMERIC,
      sharpe_ratio NUMERIC,
      rank INTEGER,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE INDEX IF NOT EXISTS idx_social_tournament_entries_tournament ON social_tournament_entries(tournament_id);`,
  `CREATE INDEX IF NOT EXISTS idx_social_tournament_entries_client ON social_tournament_entries(client_id);`,
  `CREATE TABLE IF NOT EXISTS mobile_control_notifications (
      id SERIAL PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      device_id TEXT NOT NULL,
      strategy_id TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE INDEX IF NOT EXISTS idx_mobile_control_notifications_client ON mobile_control_notifications(client_id, created_at DESC);`,
  `CREATE TABLE IF NOT EXISTS mobile_auth_states (
      state TEXT PRIMARY KEY,
      code_challenge TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      device_id TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE TABLE IF NOT EXISTS mobile_auth_challenges (
      challenge_id TEXT PRIMARY KEY,
      mfa_token TEXT NOT NULL,
      state TEXT NOT NULL,
      device_id TEXT,
      methods TEXT[] NOT NULL DEFAULT ARRAY['totp'],
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE TABLE IF NOT EXISTS mobile_device_sessions (
      session_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_email TEXT,
      user_name TEXT,
      plan TEXT,
      device_id TEXT NOT NULL,
      refresh_token_hash TEXT NOT NULL,
      access_token_expires_at TIMESTAMPTZ NOT NULL,
      roles TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
      client_ids TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
      platform TEXT,
      push_token TEXT,
      metadata JSONB,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
  `CREATE INDEX IF NOT EXISTS idx_mobile_device_sessions_user ON mobile_device_sessions(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_mobile_device_sessions_refresh ON mobile_device_sessions(refresh_token_hash);`
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
  await pool.query(`ALTER TABLE bot_guard_state ADD COLUMN IF NOT EXISTS last_ticker_source TEXT`);
  await pool.query(`ALTER TABLE bot_guard_state ADD COLUMN IF NOT EXISTS last_ticker_latency_ms INTEGER`);
  await pool.query(`ALTER TABLE bot_guard_state ADD COLUMN IF NOT EXISTS last_ticker_symbol TEXT`);
  await pool.query(`ALTER TABLE bot_guard_state ADD COLUMN IF NOT EXISTS last_ticker_recorded_at BIGINT`);

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

  await pool.query(`ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS assigned_agent_id TEXT`);
  await pool.query(`ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS assigned_agent_name TEXT`);

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
