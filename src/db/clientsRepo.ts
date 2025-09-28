import { Pool } from 'pg';

function parseJsonValue<T = any>(value: any): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return null;
  }
}

export interface ClientRow {
  id: string;
  name: string;
  owner: string;
  plan: string;
  status: string;
  contactInfo: Record<string, unknown> | null;
  limits: Record<string, unknown> | null;
  isPaused: boolean;
  killRequested: boolean;
  billingStatus: string;
  trialEndsAt: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  billingAutoPaused: boolean;
  createdAt: Date;
}

export interface ClientUpsertInput {
  id: string;
  name: string;
  owner: string;
  plan?: string;
  status?: string;
  contactInfo?: Record<string, unknown> | null;
  limits?: Record<string, unknown> | null;
  billingStatus?: string;
  trialEndsAt?: Date | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  billingAutoPaused?: boolean;
}

export class ClientsRepository {
  constructor(private readonly pool: Pool) {}

  async findById(clientId: string): Promise<ClientRow | null> {
    const res = await this.pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    if (!res.rows.length) {
      return null;
    }
    return this.mapRow(res.rows[0]);
  }

  async listAll(): Promise<ClientRow[]> {
    const res = await this.pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    return res.rows.map((row) => this.mapRow(row));
  }

  async upsert(input: ClientUpsertInput): Promise<ClientRow> {
    const res = await this.pool.query(
      `INSERT INTO clients (id, name, owner, plan, status, contact_info, limits_json, billing_status, trial_ends_at, stripe_customer_id, stripe_subscription_id, billing_auto_paused)
       VALUES (
         $1,$2,$3,
         COALESCE($4,'starter'),
         COALESCE($5,'active'),
         $6,
         $7,
         COALESCE($8,'trialing'),
         $9,
         $10,
         $11,
         COALESCE($12,false)
       )
       ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name,
           owner = EXCLUDED.owner,
           plan = EXCLUDED.plan,
           status = EXCLUDED.status,
           contact_info = EXCLUDED.contact_info,
           limits_json = EXCLUDED.limits_json,
           billing_status = COALESCE($8, clients.billing_status),
           trial_ends_at = COALESCE($9, clients.trial_ends_at),
           stripe_customer_id = COALESCE($10, clients.stripe_customer_id),
           stripe_subscription_id = COALESCE($11, clients.stripe_subscription_id),
           billing_auto_paused = COALESCE($12, clients.billing_auto_paused)
       RETURNING *`,
      [
        input.id,
        input.name,
        input.owner,
        input.plan ?? 'starter',
        input.status ?? 'active',
        input.contactInfo ?? null,
        input.limits ?? null,
        input.billingStatus ?? null,
        input.trialEndsAt ?? null,
        input.stripeCustomerId ?? null,
        input.stripeSubscriptionId ?? null,
        input.billingAutoPaused ?? null,
      ]
    );
    return this.mapRow(res.rows[0]);
  }

  async setPauseState(clientId: string, isPaused: boolean) {
    const res = await this.pool.query(
      `UPDATE clients SET is_paused = $2 WHERE id = $1 RETURNING *`,
      [clientId, isPaused]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async setBillingPause(
    clientId: string,
    update: { autoPaused: boolean; isPaused?: boolean }
  ) {
    const res = await this.pool.query(
      `UPDATE clients
       SET billing_auto_paused = $2,
           is_paused = COALESCE($3, is_paused)
       WHERE id = $1
       RETURNING *`,
      [clientId, update.autoPaused, update.isPaused ?? null]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async setKillRequest(clientId: string, kill: boolean) {
    const res = await this.pool.query(
      `UPDATE clients SET kill_requested = $2 WHERE id = $1 RETURNING *`,
      [clientId, kill]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  async updateBilling(
    clientId: string,
    update: {
      planId?: string;
      billingStatus?: string | null;
      trialEndsAt?: Date | null;
      stripeCustomerId?: string | null;
      stripeSubscriptionId?: string | null;
      billingAutoPaused?: boolean;
    }
  ): Promise<ClientRow | null> {
    const shouldUpdatePlan = update.planId !== undefined;
    const shouldUpdateBilling = update.billingStatus !== undefined;
    const shouldUpdateTrial = update.trialEndsAt !== undefined;
    const shouldUpdateCustomer = update.stripeCustomerId !== undefined;
    const shouldUpdateSubscription = update.stripeSubscriptionId !== undefined;
    const shouldUpdateAutoPause = update.billingAutoPaused !== undefined;

    const res = await this.pool.query(
      `UPDATE clients
       SET
         plan = CASE WHEN $3 THEN COALESCE($2, plan) ELSE plan END,
          billing_status = CASE WHEN $5 THEN COALESCE($4, billing_status) ELSE billing_status END,
          trial_ends_at = CASE WHEN $7 THEN $6 ELSE trial_ends_at END,
          stripe_customer_id = CASE WHEN $9 THEN $8 ELSE stripe_customer_id END,
         stripe_subscription_id = CASE WHEN $11 THEN $10 ELSE stripe_subscription_id END,
         billing_auto_paused = CASE WHEN $13 THEN COALESCE($12, billing_auto_paused) ELSE billing_auto_paused END
       WHERE id = $1
       RETURNING *`,
      [
        clientId,
        update.planId ?? null,
        shouldUpdatePlan,
        update.billingStatus ?? null,
        shouldUpdateBilling,
        update.trialEndsAt ?? null,
        shouldUpdateTrial,
        update.stripeCustomerId ?? null,
        shouldUpdateCustomer,
        update.stripeSubscriptionId ?? null,
        shouldUpdateSubscription,
        update.billingAutoPaused ?? null,
        shouldUpdateAutoPause,
      ]
    );
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  private mapRow(row: any): ClientRow {
    return {
      id: row.id,
      name: row.name,
      owner: row.owner,
      plan: row.plan,
      status: row.status,
      contactInfo: parseJsonValue(row.contact_info),
      limits: parseJsonValue(row.limits_json),
      isPaused: Boolean(row.is_paused),
      killRequested: Boolean(row.kill_requested),
      billingStatus: row.billing_status ?? 'trialing',
      trialEndsAt: row.trial_ends_at ? new Date(row.trial_ends_at) : null,
      stripeCustomerId: row.stripe_customer_id ?? null,
      stripeSubscriptionId: row.stripe_subscription_id ?? null,
      billingAutoPaused: Boolean(row.billing_auto_paused),
      createdAt: row.created_at,
    };
  }
}

export interface ClientApiCredentialRow {
  clientId: string;
  exchangeName: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
  passphraseEnc: string | null;
  createdAt: Date;
}

export interface ClientStrategySecretRow {
  clientId: string;
  strategyId: string;
  secretEnc: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClientApiCredentialUpsert {
  clientId: string;
  exchangeName: string;
  apiKeyEnc: string;
  apiSecretEnc: string;
  passphraseEnc?: string | null;
}

export class ClientApiCredentialsRepository {
  constructor(private readonly pool: Pool) {}

  async getCredentials(clientId: string, exchangeName: string): Promise<ClientApiCredentialRow | null> {
    const res = await this.pool.query(
      `SELECT * FROM client_api_credentials WHERE client_id = $1 AND exchange_name = $2`,
      [clientId, exchangeName]
    );
    if (!res.rows.length) {
      return null;
    }
    const row = res.rows[0];
    return {
      clientId: row.client_id,
      exchangeName: row.exchange_name,
      apiKeyEnc: row.api_key_enc,
      apiSecretEnc: row.api_secret_enc,
      passphraseEnc: row.passphrase_enc,
      createdAt: row.created_at,
    };
  }

  async listByClient(clientId: string): Promise<ClientApiCredentialRow[]> {
    const res = await this.pool.query(
      `SELECT * FROM client_api_credentials
       WHERE client_id = $1
       ORDER BY created_at DESC`,
      [clientId]
    );
    return res.rows.map((row) => ({
      clientId: row.client_id,
      exchangeName: row.exchange_name,
      apiKeyEnc: row.api_key_enc,
      apiSecretEnc: row.api_secret_enc,
      passphraseEnc: row.passphrase_enc,
      createdAt: row.created_at,
    }));
  }

  async upsert(input: ClientApiCredentialUpsert): Promise<ClientApiCredentialRow> {
    const res = await this.pool.query(
      `INSERT INTO client_api_credentials (client_id, exchange_name, api_key_enc, api_secret_enc, passphrase_enc)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (client_id, exchange_name) DO UPDATE
       SET api_key_enc = EXCLUDED.api_key_enc,
           api_secret_enc = EXCLUDED.api_secret_enc,
           passphrase_enc = EXCLUDED.passphrase_enc
       RETURNING *`,
      [
        input.clientId,
        input.exchangeName,
        input.apiKeyEnc,
        input.apiSecretEnc,
        input.passphraseEnc ?? null,
      ]
    );
    const row = res.rows[0];
    return {
      clientId: row.client_id,
      exchangeName: row.exchange_name,
      apiKeyEnc: row.api_key_enc,
      apiSecretEnc: row.api_secret_enc,
      passphraseEnc: row.passphrase_enc,
      createdAt: row.created_at,
    };
  }

  async delete(clientId: string, exchangeName: string) {
    await this.pool.query(`DELETE FROM client_api_credentials WHERE client_id = $1 AND exchange_name = $2`, [
      clientId,
      exchangeName,
    ]);
  }
}

export interface ClientStrategySecretUpsert {
  clientId: string;
  strategyId: string;
  secretEnc: string;
  metadata?: Record<string, unknown> | null;
}

export class ClientStrategySecretsRepository {
  constructor(private readonly pool: Pool) {}

  async get(clientId: string, strategyId: string): Promise<ClientStrategySecretRow | null> {
    const res = await this.pool.query(
      `SELECT * FROM client_strategy_secrets WHERE client_id = $1 AND strategy_id = $2`,
      [clientId, strategyId]
    );
    if (!res.rows.length) return null;
    return this.mapRow(res.rows[0]);
  }

  async upsert(input: ClientStrategySecretUpsert): Promise<ClientStrategySecretRow> {
    const res = await this.pool.query(
      `INSERT INTO client_strategy_secrets (client_id, strategy_id, secret_enc, metadata_json)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (client_id, strategy_id) DO UPDATE
       SET secret_enc = EXCLUDED.secret_enc,
           metadata_json = EXCLUDED.metadata_json,
           updated_at = NOW()
       RETURNING *`,
      [input.clientId, input.strategyId, input.secretEnc, input.metadata ?? null]
    );
    return this.mapRow(res.rows[0]);
  }

  async delete(clientId: string, strategyId: string) {
    await this.pool.query(`DELETE FROM client_strategy_secrets WHERE client_id = $1 AND strategy_id = $2`, [
      clientId,
      strategyId,
    ]);
  }

  private mapRow(row: any): ClientStrategySecretRow {
    return {
      clientId: row.client_id,
      strategyId: row.strategy_id,
      secretEnc: row.secret_enc,
      metadata: parseJsonValue<Record<string, unknown>>(row.metadata_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
