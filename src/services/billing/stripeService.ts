import Stripe from 'stripe';
import { ClientsRepository } from '../../db/clientsRepo';
import { PLAN_DEFINITIONS, buildPlanLimits, getPlanById } from '../../config/plans';

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
  customerId?: string | null; // allow reuse of existing Stripe customer
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
    // Reuse customer if we have it to avoid creating duplicates
    customer: options.customerId ?? undefined,
    metadata: {
      client_id: options.clientId,
      plan_id: plan.id,
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
      },
    },
  });
  return session;
}

// Create a Billing Portal session for an existing Stripe customer
export async function createBillingPortalSession(options: {
  customerId: string;
  returnUrl: string;
}) {
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: options.customerId,
    return_url: options.returnUrl,
  });
  return session;
}

function resolvePlanLimits(planId: string | null | undefined) {
  if (!planId) return null;
  const plan = getPlanById(planId);
  if (!plan) return null;
  return buildPlanLimits(plan);
}

// Helper: map Stripe price ID -> internal plan id
function planIdFromPriceId(priceId: string | null | undefined): string | null {
  if (!priceId) return null;
  const plan = PLAN_DEFINITIONS.find((p) => p.stripePriceId === priceId);
  return plan?.id ?? null;
}

export async function handleStripeWebhook(
  payload: any,
  clientsRepo: ClientsRepository
) {
  if (!payload?.type) {
    throw new Error('invalid_webhook_payload');
  }
  const type = payload.type as string;

  if (type === 'checkout.session.completed') {
    const session = payload.data?.object as Stripe.Checkout.Session | undefined;
    if (!session) return;
    const clientId = session.metadata?.client_id;
    const planId = session.metadata?.plan_id;
    if (!clientId || !planId) return;
    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : (session.subscription as Stripe.Subscription | undefined)?.id ?? null;
    const customerId =
      typeof session.customer === 'string'
        ? session.customer
        : (session.customer as Stripe.Customer | undefined)?.id ?? null;

    await clientsRepo.upsert({
      id: clientId,
      name: clientId,
      owner: clientId,
      plan: planId,
      limits: resolvePlanLimits(planId) ?? undefined,
      billingStatus: session.payment_status === 'paid' ? 'active' : 'pending',
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      trialEndsAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    });
    return;
  }

  if (type === 'customer.subscription.updated' || type === 'customer.subscription.created') {
    const subscription = payload.data?.object as Stripe.Subscription | undefined;
    if (!subscription) return;
    const clientId = subscription.metadata?.client_id;
    // Prefer deriving the plan from the price on the active subscription item
    const firstItem = Array.isArray(subscription.items?.data) ? subscription.items.data[0] : undefined;
    const priceId =
      (firstItem?.price && typeof firstItem.price === 'object' ? (firstItem.price as Stripe.Price).id : null) ?? null;
    const planIdDerived = planIdFromPriceId(priceId);
    const planIdMeta = subscription.metadata?.plan_id;
    const effectivePlanId = planIdDerived || planIdMeta || null;

    if (!clientId) return;
    const trialEndsAt = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;
    const billingStatus = subscription.status ?? 'active';

    await clientsRepo.updateBilling(clientId, {
      planId: effectivePlanId ?? undefined,
      billingStatus,
      trialEndsAt,
      stripeCustomerId:
        typeof subscription.customer === 'string'
          ? subscription.customer
          : (subscription.customer as Stripe.Customer | undefined)?.id ?? undefined,
      stripeSubscriptionId: subscription.id,
      billingAutoPaused: ['active', 'past_due', 'trialing'].includes(billingStatus) ? false : undefined,
    });

    if (effectivePlanId) {
      const limits = resolvePlanLimits(effectivePlanId);
      if (limits) {
        await clientsRepo.upsert({
          id: clientId,
          name: clientId,
          owner: clientId,
          plan: effectivePlanId,
          limits,
          billingStatus,
        });
      }
    }
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
}

export function verifyStripeSignature(rawBody: string, signature: string) {
  if (!STRIPE_WEBHOOK_SECRET) {
    throw new Error('stripe_webhook_secret_missing');
  }
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
}
