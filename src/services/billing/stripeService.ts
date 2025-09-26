import Stripe from 'stripe';
import { SpanStatusCode } from '@opentelemetry/api';
import { ClientsRepository } from '../../db/clientsRepo';
import { buildPlanLimits, getPlanById, getPlanByPriceId } from '../../config/plans';
import { startSpan } from '../../telemetry/tracing';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  if (!STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  if (!stripeClient) {
    stripeClient = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2022-11-15',
    });
  }
  return stripeClient;
}

export async function createCheckoutSession(options: {
  clientId: string;
  planId: string;
  successUrl: string;
  cancelUrl: string;
  trialDays?: number;
  stripeCustomerId?: string | null;
  customerEmail?: string | null;
}) {
  const plan = getPlanById(options.planId);
  if (!plan) {
    throw new Error(`Unknown plan: ${options.planId}`);
  }
  if (!plan.stripePriceId) {
    throw new Error(`Plan ${plan.id} missing stripePriceId`);
  }
  const trialDays = options.trialDays ?? 3;
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    success_url: options.successUrl,
    cancel_url: options.cancelUrl,
    client_reference_id: options.clientId,
    allow_promotion_codes: true,
    metadata: {
      client_id: options.clientId,
      plan_id: plan.id,
      trial_days: String(trialDays),
    },
    line_items: [
      {
        price: plan.stripePriceId,
        quantity: 1,
      },
    ],
    subscription_data: {
      trial_period_days: trialDays,
      metadata: {
        client_id: options.clientId,
        plan_id: plan.id,
        trial_days: String(trialDays),
      },
    },
    customer: options.stripeCustomerId ?? undefined,
    customer_email: options.stripeCustomerId ? undefined : options.customerEmail ?? undefined,
  });
  return session;
}

export async function createBillingPortalSession(options: {
  customerId: string;
  returnUrl: string;
}) {
  const stripe = getStripe();
  return stripe.billingPortal.sessions.create({
    customer: options.customerId,
    return_url: options.returnUrl,
  });
}

function resolvePlanLimits(planId: string | null | undefined) {
  if (!planId) return null;
  const plan = getPlanById(planId);
  if (!plan) return null;
  return buildPlanLimits(plan);
}

const ACTIVE_BILLING_STATUSES = new Set(['active', 'trialing', 'past_due']);

function shouldAutoPauseBilling(status: string) {
  return !ACTIVE_BILLING_STATUSES.has(status);
}

function computeTrialEndsAtFromSession(session: Stripe.Checkout.Session): Date | null {
  const trialDaysRaw = session.metadata?.trial_days;
  const trialDays = trialDaysRaw ? Number(trialDaysRaw) : 3;
  if (!trialDays || Number.isNaN(trialDays)) {
    return null;
  }
  const createdTs = typeof session.created === 'number' ? session.created * 1000 : Date.now();
  return new Date(createdTs + trialDays * 24 * 60 * 60 * 1000);
}

function derivePlanIdFromSubscription(subscription: Stripe.Subscription): string | null {
  const metadataPlanId = subscription.metadata?.plan_id;
  if (metadataPlanId && getPlanById(metadataPlanId)) {
    return metadataPlanId;
  }
  const primaryItem = subscription.items?.data?.[0];
  const priceId = primaryItem?.price?.id;
  const planByPrice = getPlanByPriceId(priceId ?? undefined);
  return planByPrice?.id ?? null;
}

async function applyCheckoutSession(
  session: Stripe.Checkout.Session,
  clientsRepo: ClientsRepository
) {
  const clientId = session.metadata?.client_id ?? session.client_reference_id ?? null;
  const planId = session.metadata?.plan_id ?? null;
  if (!clientId || !planId) {
    return null;
  }
  const subscriptionId =
    typeof session.subscription === 'string'
      ? session.subscription
      : (session.subscription as Stripe.Subscription | undefined)?.id ?? null;
  const customerId =
    typeof session.customer === 'string'
      ? session.customer
      : (session.customer as Stripe.Customer | undefined)?.id ?? null;
  const trialEndsAt = computeTrialEndsAtFromSession(session);
  const billingStatus = session.payment_status === 'paid' ? 'active' : 'pending';

  await clientsRepo.upsert({
    id: clientId,
    name: clientId,
    owner: clientId,
    plan: planId,
    limits: resolvePlanLimits(planId) ?? undefined,
    billingStatus,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    trialEndsAt: trialEndsAt ?? null,
  });

  return { clientId, planId, subscriptionId };
}

async function applySubscriptionUpdate(
  subscription: Stripe.Subscription,
  clientsRepo: ClientsRepository
) {
  const clientId = subscription.metadata?.client_id;
  if (!clientId) {
    return null;
  }
  const planId = derivePlanIdFromSubscription(subscription);
  const trialEndsAt = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;
  const billingStatus = subscription.status ?? 'active';
  const billingAutoPaused = shouldAutoPauseBilling(billingStatus);

  await clientsRepo.updateBilling(clientId, {
    planId: planId ?? undefined,
    billingStatus,
    trialEndsAt,
    stripeCustomerId:
      typeof subscription.customer === 'string'
        ? subscription.customer
        : (subscription.customer as Stripe.Customer | undefined)?.id ?? undefined,
    stripeSubscriptionId: subscription.id,
    billingAutoPaused,
  });

  if (planId) {
    const limits = resolvePlanLimits(planId);
    if (limits) {
      await clientsRepo.upsert({
        id: clientId,
        name: clientId,
        owner: clientId,
        plan: planId,
        limits,
        billingStatus,
      });
    }
  }

  return { clientId, planId };
}

export async function handleStripeWebhook(
  payload: any,
  clientsRepo: ClientsRepository
) {
  const span = startSpan('stripe_webhook', { eventType: payload?.type ?? 'unknown' });
  try {
    if (!payload?.type) {
      throw new Error('invalid_webhook_payload');
    }
    const type = payload.type as string;

    if (type === 'checkout.session.completed') {
      const session = payload.data?.object as Stripe.Checkout.Session | undefined;
      if (!session) return;
      await applyCheckoutSession(session, clientsRepo);
      return;
    }

    if (type === 'customer.subscription.updated' || type === 'customer.subscription.created') {
      const subscription = payload.data?.object as Stripe.Subscription | undefined;
      if (!subscription) return;
      await applySubscriptionUpdate(subscription, clientsRepo);
      return;
    }

    if (type === 'customer.subscription.deleted') {
      const subscription = payload.data?.object as Stripe.Subscription | undefined;
      if (!subscription) return;
      const clientId = subscription.metadata?.client_id;
      if (!clientId) return;
      await clientsRepo.updateBilling(clientId, {
        billingStatus: 'canceled',
        stripeSubscriptionId: null,
        billingAutoPaused: true,
      });
      return;
    }
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    span.end();
  }
}

export function verifyStripeSignature(rawBody: string, signature: string) {
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error('stripe_webhook_secret_missing');
  }
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
}

export async function syncCheckoutSession(sessionId: string, clientsRepo: ClientsRepository) {
  const span = startSpan('stripe_checkout_sync', { sessionId });
  try {
    if (!sessionId) {
      throw new Error('session_id_required');
    }
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });
    const checkoutResult = await applyCheckoutSession(session, clientsRepo);

    let subscription: Stripe.Subscription | null = null;
    if (session.subscription) {
      if (typeof session.subscription === 'string') {
        subscription = await stripe.subscriptions.retrieve(session.subscription, {
          expand: ['items.data.price'],
        });
      } else {
        subscription = session.subscription as Stripe.Subscription;
      }
    }

    if (subscription) {
      await applySubscriptionUpdate(subscription, clientsRepo);
    }

    const clientId =
      checkoutResult?.clientId ??
      subscription?.metadata?.client_id ??
      session.metadata?.client_id ??
      session.client_reference_id ??
      null;

    return clientId ? clientsRepo.findById(clientId) : null;
  } catch (error) {
    span.recordException(error as Error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    span.end();
  }
}
