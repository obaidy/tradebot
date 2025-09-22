import Head from 'next/head';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '../../components/layout/DashboardLayout';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';

type Plan = {
  id: string;
  name: string;
  description: string;
  priceUsd: number;
  features: string[];
};

function formatTrialCountdown(trialEndsAt: string | null) {
  if (!trialEndsAt) return null;
  const ending = new Date(trialEndsAt).getTime();
  const now = Date.now();
  const diffMs = ending - now;
  if (diffMs <= 0) return 'Expired';
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const diffHours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (diffDays > 0) return `${diffDays} day${diffDays === 1 ? '' : 's'} ${diffHours}h remaining`;
  const diffMinutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
  return `${diffHours}h ${diffMinutes}m remaining`;
}

async function fetchJson(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export default function BillingPage() {
  const { status } = useSession({ required: true });
  const [plans, setPlans] = useState<Plan[]>([]);
  const [snapshot, setSnapshot] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const client = snapshot?.client ?? {};
  const currentPlanId = (client.plan ?? client.planId) || 'starter';
  const billingStatus = client.billingStatus ?? client.billing_status ?? 'trialing';
  const trialEndsRaw = client.trialEndsAt ?? client.trial_ends_at ?? null;
  const trialEndsIso = trialEndsRaw ? new Date(trialEndsRaw).toISOString() : null;
  const trialCountdown = useMemo(() => formatTrialCountdown(trialEndsIso), [trialEndsIso]);
  const hasCustomer = Boolean(client.stripeCustomerId ?? client.stripe_customer_id);

  const currentPlan = useMemo(
    () => plans.find((p) => p.id === currentPlanId) ?? null,
    [plans, currentPlanId]
  );
  const otherPlans = useMemo(() => plans.filter((p) => p.id !== currentPlanId), [plans, currentPlanId]);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const [plansRes, snap] = await Promise.all([
        fetchJson('/api/client/plans'),
        fetchJson('/api/client/snapshot'),
      ]);
      setPlans(plansRes);
      setSnapshot(snap);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed_to_load_billing');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (status === 'loading') return;
    load();
  }, [status]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const checkoutStatus = params.get('checkout');
    if (checkoutStatus === 'success') {
      setMessage('Subscription updated successfully.');
      params.delete('checkout');
      const newSearch = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}`);
      load().catch(() => {});
    } else if (checkoutStatus === 'cancelled') {
      setMessage('Checkout cancelled. No changes were made.');
      params.delete('checkout');
      const newSearch = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}`);
    }
    const portalDone = params.get('portal');
    if (portalDone === 'done') {
      setMessage('Billing portal closed. Your subscription details are refreshed.');
      params.delete('portal');
      const newSearch = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}`);
      load().catch(() => {});
    }
  }, []);

  async function openPortal() {
    try {
      setProcessing(true);
      setError(null);
      const resp = await fetchJson('/api/client/billing/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'portal' }),
      });
      if (resp?.url) window.location.href = resp.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'portal_open_failed');
    } finally {
      setProcessing(false);
    }
  }

  async function startCheckout(planId: string) {
    try {
      setProcessing(true);
      setError(null);
      const resp = await fetchJson('/api/client/billing/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, action: 'checkout' }),
      });
      if (resp?.url) window.location.href = resp.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'checkout_failed');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <>
      <Head>
        <title>TradeBot · Billing</title>
      </Head>
      <DashboardLayout
        topRightSlot={
          <Link href="/app" legacyBehavior>
            <a>
              <Button variant="ghost">Back to dashboard</Button>
            </a>
          </Link>
        }
      >
        <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {loading ? <Card>Loading…</Card> : null}
          {message ? (
            <Card elevation="none" glass style={{ border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.12)' }}>
              {message}
            </Card>
          ) : null}
          {error ? (
            <Card elevation="none" glass style={{ border: '1px solid rgba(248,113,113,0.35)', background: 'rgba(127,29,29,0.25)' }}>
              {error}
            </Card>
          ) : null}

          {!loading ? (
            <>
              <Card style={{ display: 'grid', gap: '0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <Badge tone="primary">Current subscription</Badge>
                    <h2 style={{ margin: '0.6rem 0 0' }}>{currentPlan?.name ?? currentPlanId}</h2>
                  </div>
                  <Badge tone={billingStatus === 'active' ? 'success' : billingStatus === 'trialing' ? 'primary' : 'warning'}>
                    {billingStatus}
                  </Badge>
                </div>
                <p style={{ margin: 0, color: '#94A3B8' }}>{currentPlan?.description ?? 'Active plan'}</p>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  {trialEndsIso ? (
                    <Badge tone={billingStatus === 'trialing' ? 'warning' : 'neutral'}>
                      Trial ends: {trialCountdown}
                    </Badge>
                  ) : null}
                  {hasCustomer ? (
                    <Button variant="secondary" onClick={openPortal} disabled={processing}>
                      Manage subscription
                    </Button>
                  ) : (
                    <Button variant="secondary" disabled title="Create a subscription to enable the portal">
                      Manage subscription
                    </Button>
                  )}
                </div>
              </Card>

              <Card style={{ display: 'grid', gap: '1rem' }}>
                <div>
                  <Badge tone="primary">Change plan</Badge>
                  <h2 style={{ margin: '0.6rem 0 0' }}>Available plans</h2>
                </div>
                <div style={{ display: 'grid', gap: '0.9rem' }}>
                  {otherPlans.length === 0 ? (
                    <p style={{ color: '#94A3B8', margin: 0 }}>You’re already on the only available plan.</p>
                  ) : (
                    otherPlans.map((plan) => (
                      <Card
                        key={plan.id}
                        elevation="none"
                        glass={false}
                        style={{
                          border: '1px solid rgba(148,163,184,0.12)',
                          background: 'rgba(15,23,42,0.55)',
                          padding: '1rem 1.1rem',
                          display: 'grid',
                          gap: '0.5rem',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong>{plan.name}</strong>
                          <span>${plan.priceUsd}/mo</span>
                        </div>
                        <p style={{ margin: 0, color: '#94A3B8' }}>{plan.description}</p>
                        <Button onClick={() => startCheckout(plan.id)} disabled={processing}>
                          {billingStatus === 'trialing' ? 'Upgrade' : 'Change to this plan'}
                        </Button>
                      </Card>
                    ))
                  )}
                </div>
              </Card>
            </>
          ) : null}
        </div>
      </DashboardLayout>
    </>
  );
}
