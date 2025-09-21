import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newDb } from 'pg-mem';
import { Pool } from 'pg';
import { runMigrations } from '../src/db/migrations';
import { ClientsRepository } from '../src/db/clientsRepo';
import { handleStripeWebhook } from '../src/services/billing/stripeService';

function createPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  const adapter = db.adapters.createPg();
  const pool = new adapter.Pool();
  return { pool, db };
}

describe('Stripe billing webhook handler', () => {
  let pool: Pool;
  let clientsRepo: ClientsRepository;

  beforeEach(async () => {
    const ctx = createPool();
    pool = ctx.pool as unknown as Pool;
    await runMigrations(pool);
    clientsRepo = new ClientsRepository(pool);
  });

  afterEach(async () => {
    if (pool) {
      await (pool as any).end();
    }
  });

  it('records checkout completion and seeds subscription metadata', async () => {
    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          metadata: {
            client_id: 'client-billing',
            plan_id: 'starter',
          },
          payment_status: 'paid',
          subscription: 'sub_123',
          customer: 'cus_123',
        },
      },
    };

    await handleStripeWebhook(event as any, clientsRepo);
    const client = await clientsRepo.findById('client-billing');
    expect(client).not.toBeNull();
    expect(client?.plan).toBe('starter');
    expect(client?.billingStatus).toBe('active');
    expect(client?.stripeSubscriptionId).toBe('sub_123');
    expect(client?.limits?.maxSymbols).toBe(3);
    expect(client?.trialEndsAt).not.toBeNull();
    expect(client?.billingAutoPaused).toBe(false);
  });

  it('updates subscription lifecycle and limits on update events', async () => {
    await clientsRepo.upsert({
      id: 'client-update',
      name: 'client-update',
      owner: 'client-update',
      plan: 'starter',
      limits: {
        maxSymbols: 3,
      },
    });

    const updateEvent = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_456',
          metadata: {
            client_id: 'client-update',
            plan_id: 'pro',
          },
          status: 'active',
          trial_end: Math.floor(Date.now() / 1000) + 3600,
          customer: 'cus_456',
        },
      },
    };

    await handleStripeWebhook(updateEvent as any, clientsRepo);
    const client = await clientsRepo.findById('client-update');
    expect(client?.plan).toBe('pro');
    expect(client?.billingStatus).toBe('active');
    expect(client?.stripeSubscriptionId).toBe('sub_456');
    expect(client?.limits?.maxSymbols).toBe(10);
    expect(client?.billingAutoPaused).toBe(false);
  });

  it('marks subscriptions as canceled on deletion', async () => {
    await clientsRepo.upsert({
      id: 'client-cancel',
      name: 'client-cancel',
      owner: 'client-cancel',
      plan: 'pro',
      billingStatus: 'active',
      stripeSubscriptionId: 'sub_cancel',
      limits: {
        maxSymbols: 10,
      },
    });

    const deleteEvent = {
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_cancel',
          metadata: {
            client_id: 'client-cancel',
          },
        },
      },
    };

    await handleStripeWebhook(deleteEvent as any, clientsRepo);
    const client = await clientsRepo.findById('client-cancel');
    expect(client?.billingStatus).toBe('canceled');
    expect(client?.stripeSubscriptionId).toBeNull();
    expect(client?.billingAutoPaused).toBe(true);
  });
});
