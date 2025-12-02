import Head from 'next/head';
import { useSession } from 'next-auth/react';
import { useMemo, useState } from 'react';
import { DashboardLayout } from '../../components/layout/DashboardLayout';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { palette } from '../../styles/theme';
import { usePortalData } from '../../hooks/usePortalData';
import type { Plan } from '../../types/portal';

export default function BillingPage() {
  const { status } = useSession({ required: true });
  const { data, loading, error } = usePortalData({ enabled: status === 'authenticated' });
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const plans = useMemo(() => data?.plans ?? [], [data?.plans]);
  const selectedPlan = useMemo(() => {
    return plans.find((plan) => plan.id === data?.snapshot?.client?.plan) ?? plans[0] ?? null;
  }, [plans, data?.snapshot?.client?.plan]);

  const billingStatus = data?.snapshot?.client?.billingStatus ?? 'trialing';
  const trialEnds = data?.snapshot?.client?.trialEndsAt;

  async function handleUpgrade(planId: string) {
    try {
      setProcessing(true);
      setMessage(null);
      const res = await fetch('/api/client/billing/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || 'Unable to start checkout');
      }
      const payload = await res.json();
      if (payload?.url) {
        window.location.href = payload.url;
      } else {
        setMessage('Checkout link unavailable. Contact support.');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to open checkout');
    } finally {
      setProcessing(false);
    }
  }

  async function handleManagePortal() {
    try {
      setProcessing(true);
      setMessage(null);
      const res = await fetch('/api/client/billing/portal', { method: 'POST' });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || 'Unable to open customer portal');
      }
      const payload = await res.json();
      if (payload?.url) {
        window.location.href = payload.url;
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to open billing portal');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <DashboardLayout>
      <Head>
        <title>Billing · OctoBot Portal</title>
      </Head>
      <header style={{ marginBottom: '1.5rem' }}>
        <Badge tone="primary">Billing</Badge>
        <h1 style={{ margin: '0.5rem 0 0' }}>Plan &amp; invoices</h1>
        <p style={{ margin: '0.35rem 0 0', color: palette.textSecondary }}>
          Manage your plan, review limits, and launch Stripe checkout whenever you’re ready to upgrade.
        </p>
      </header>

      {error ? (
        <Card style={{ border: '1px solid rgba(248,113,113,0.45)', marginBottom: '1rem' }}>
          <p style={{ margin: 0, color: palette.danger }}>{error.message}</p>
        </Card>
      ) : null}

      <section style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', flexWrap: 'wrap' }}>
        <Card>
          <h2 style={{ marginTop: 0 }}>{selectedPlan ? selectedPlan.name : 'Plan'}</h2>
          <p style={{ color: palette.textSecondary }}>
            Status: {billingStatus}{' '}
            {trialEnds ? `· Renewal ${new Date(trialEnds).toLocaleDateString()}` : ''}
          </p>
          <ul>
            {(selectedPlan?.features ?? []).map((feature) => (
              <li key={feature} style={{ color: palette.textPrimary }}>
                {feature}
              </li>
            ))}
          </ul>
        </Card>
        <Card style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h3 style={{ margin: 0 }}>Actions</h3>
          <Button onClick={() => handleUpgrade('pro')} disabled={processing || loading}>
            Upgrade
          </Button>
          <Button variant="secondary" onClick={handleManagePortal} disabled={processing || loading}>
            Manage subscription
          </Button>
          {message ? <p style={{ color: palette.warning, margin: 0 }}>{message}</p> : null}
        </Card>
      </section>

      <section style={{ marginTop: '2rem' }}>
        <h3>Other plans</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
          {plans
            .filter((plan) => !selectedPlan || plan.id !== selectedPlan.id)
            .map((plan: Plan) => (
              <Card key={plan.id}>
                <h4 style={{ margin: '0 0 0.35rem' }}>{plan.name}</h4>
                <p style={{ margin: 0, color: palette.textSecondary }}>{plan.description}</p>
                <ul style={{ marginTop: '0.5rem', paddingLeft: '1rem' }}>
                  {plan.features.slice(0, 3).map((feature) => (
                    <li key={feature} style={{ color: palette.textSecondary }}>
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button variant="secondary" onClick={() => handleUpgrade(plan.id)} disabled={processing}>
                  Choose {plan.name}
                </Button>
              </Card>
            ))}
        </div>
      </section>
    </DashboardLayout>
  );
}
