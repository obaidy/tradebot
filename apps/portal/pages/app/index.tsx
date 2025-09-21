import Head from 'next/head';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';

type Plan = {
  id: string;
  name: string;
  description: string;
  priceUsd: number;
  features: string[];
  limits: {
    maxSymbols: number;
    allowLiveTrading: boolean;
    maxPerTradeUsd: number;
  };
};

type AuditEntry = {
  id: number;
  action: string;
  actor: string;
  createdAt: string;
  metadata?: Record<string, unknown> | null;
};

function formatDate(input: string) {
  return new Date(input).toLocaleString();
}

async function fetchJson(url: string, options?: RequestInit) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export default function Dashboard() {
  const { data: session, status } = useSession({ required: true });
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<string>('starter');
  const [credentials, setCredentials] = useState<any[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [apiForm, setApiForm] = useState({ exchangeName: 'binance', apiKey: '', apiSecret: '', passphrase: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const clientId = session?.user?.id;
  const actor = useMemo(() => session?.user?.email ?? clientId ?? 'unknown', [session?.user?.email, clientId]);

  useEffect(() => {
    if (!clientId || status === 'loading') return;
    let cancelled = false;

    async function bootstrap() {
      try {
        setLoading(true);
        setError(null);
        await fetchJson('/api/client/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: 'starter' }),
        });
        const [plansRes, snapshot, credsRes, auditRes, metricsRes] = await Promise.all([
          fetchJson('/api/client/plans'),
          fetchJson('/api/client/snapshot'),
          fetchJson('/api/client/credentials'),
          fetchJson('/api/client/audit'),
          fetchJson('/api/client/metrics').catch(() => null),
        ]);
        if (cancelled) return;
        setPlans(plansRes);
        setSelectedPlan(snapshot?.client?.plan ?? 'starter');
        setCredentials(credsRes);
        setAuditEntries(auditRes);
        setMetrics(metricsRes);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load workspace');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [clientId, status]);

  useEffect(() => {
    if (!clientId || typeof window === 'undefined') return undefined;
    const source = new EventSource('/api/client/metrics/stream');
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        setMetrics(data);
      } catch {
        // ignore malformed events
      }
    };
    source.onerror = () => {
      source.close();
    };
    return () => {
      source.close();
    };
  }, [clientId]);

  async function handlePlanChange(planId: string) {
    try {
      setMessage(null);
      setError(null);
      await fetchJson('/api/client/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planId }),
      });
      setSelectedPlan(planId);
      await refreshAudit();
      setMessage('Plan updated');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Plan update failed');
    }
  }

  async function refreshAudit() {
    const entries = await fetchJson('/api/client/audit');
    setAuditEntries(entries);
  }

  async function handleCredentialSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      setMessage(null);
      setError(null);
      await fetchJson('/api/client/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiForm),
      });
      setMessage('Credentials stored securely');
      setApiForm({ ...apiForm, apiKey: '', apiSecret: '', passphrase: '' });
      const creds = await fetchJson('/api/client/credentials');
      setCredentials(creds);
      await refreshAudit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to store credentials');
    }
  }

  async function handleTriggerPaper() {
    try {
      setMessage(null);
      setError(null);
      await fetchJson('/api/client/paper', { method: 'POST' });
      setMessage('Paper run requested. Check back shortly for updates.');
      await refreshAudit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to trigger paper run');
    }
  }

  if (status === 'loading' || loading) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p>Loading your workspace…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <section style={{ padding: '2rem', background: '#1f2937', borderRadius: 16 }}>
          <h1>Something went wrong</h1>
          <p>{error}</p>
          <button type="button" onClick={() => location.reload()} style={{ marginTop: '1rem' }}>
            Retry
          </button>
        </section>
      </main>
    );
  }

  return (
    <>
      <Head>
        <title>Portal Dashboard</title>
      </Head>
      <main style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0' }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '1.5rem 3rem',
            borderBottom: '1px solid #1e293b',
          }}
        >
          <div>
            <h1 style={{ margin: 0, fontSize: '1.5rem' }}>Client Workspace</h1>
            <p style={{ margin: 0, color: '#94a3b8' }}>Signed in as {session?.user?.email ?? actor}</p>
          </div>
          <button
            type="button"
            onClick={() => signOut({ callbackUrl: '/' })}
            style={{
              padding: '0.6rem 1.2rem',
              borderRadius: 10,
              background: '#f87171',
              color: '#111827',
              border: 'none',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </header>

        <section style={{ padding: '2rem 3rem', display: 'grid', gap: '1.5rem', maxWidth: 1000, margin: '0 auto' }}>
          {message && (
            <div style={{ background: '#14532d', padding: '0.75rem 1rem', borderRadius: 12, color: '#bbf7d0' }}>{message}</div>
          )}

          <article style={{ background: '#111c2f', padding: '1.75rem', borderRadius: 16 }}>
            <h2 style={{ marginTop: 0 }}>Choose your plan</h2>
            <div style={{ display: 'grid', gap: '1rem' }}>
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => handlePlanChange(plan.id)}
                  style={{
                    textAlign: 'left',
                    padding: '1rem 1.25rem',
                    borderRadius: 12,
                    border: plan.id === selectedPlan ? '2px solid #38bdf8' : '1px solid #1e293b',
                    background: plan.id === selectedPlan ? '#0b1730' : 'transparent',
                    color: '#e2e8f0',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong>{plan.name}</strong>
                    <span>${plan.priceUsd}/mo</span>
                  </div>
                  <p style={{ color: '#94a3b8' }}>{plan.description}</p>
                  <ul style={{ margin: 0, paddingLeft: '1.2rem', color: '#cbd5f5' }}>
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                </button>
              ))}
            </div>
          </article>

          <article style={{ background: '#111c2f', padding: '1.75rem', borderRadius: 16 }}>
            <h2 style={{ marginTop: 0 }}>Add exchange keys</h2>
            <p style={{ color: '#94a3b8' }}>
              Provide trade-only API keys. They are encrypted with your tenant master key before hitting the database.
            </p>
            <form onSubmit={handleCredentialSubmit} style={{ display: 'grid', gap: '1rem', maxWidth: 420 }}>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>Exchange</span>
                <input
                  value={apiForm.exchangeName}
                  onChange={(e) => setApiForm({ ...apiForm, exchangeName: e.target.value })}
                  style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid #1f2937' }}
                  required
                />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>API Key</span>
                <input
                  value={apiForm.apiKey}
                  onChange={(e) => setApiForm({ ...apiForm, apiKey: e.target.value })}
                  style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid #1f2937' }}
                  required
                />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>API Secret</span>
                <input
                  value={apiForm.apiSecret}
                  onChange={(e) => setApiForm({ ...apiForm, apiSecret: e.target.value })}
                  style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid #1f2937' }}
                  required
                />
              </label>
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span>Passphrase (optional)</span>
                <input
                  value={apiForm.passphrase}
                  onChange={(e) => setApiForm({ ...apiForm, passphrase: e.target.value })}
                  style={{ padding: '0.6rem 0.75rem', borderRadius: 8, border: '1px solid #1f2937' }}
                />
              </label>
              <button
                type="submit"
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: 10,
                  border: 'none',
                  background: '#2563eb',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Save credentials
              </button>
            </form>
            <div style={{ marginTop: '1.5rem' }}>
              <h3>Stored exchanges</h3>
              {credentials.length === 0 ? (
                <p style={{ color: '#94a3b8' }}>No credentials stored yet.</p>
              ) : (
                <ul style={{ paddingLeft: '1.2rem' }}>
                  {credentials.map((cred) => (
                    <li key={cred.exchangeName}>{cred.exchangeName} — stored {formatDate(cred.createdAt)}</li>
                  ))}
                </ul>
              )}
            </div>
          </article>

          <article style={{ background: '#111c2f', padding: '1.75rem', borderRadius: 16 }}>
            <h2 style={{ marginTop: 0 }}>Paper validation</h2>
            <p style={{ color: '#94a3b8' }}>
              Request a paper run with your current plan and keys. Operators will review metrics before unlocking live trading.
            </p>
            <button
              type="button"
              onClick={handleTriggerPaper}
              style={{
                padding: '0.75rem 1rem',
                borderRadius: 10,
                border: '1px solid #2563eb',
                background: 'transparent',
                color: '#38bdf8',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Request paper run
            </button>
            <div style={{ marginTop: '1.5rem' }}>
              <h3>Metrics snapshot</h3>
              {metrics ? (
                <ul style={{ lineHeight: 1.7, color: '#cbd5f5' }}>
                  <li>Global P&L: ${metrics.pnl.global.toFixed(2)}</li>
                  <li>Run P&L: ${metrics.pnl.run.toFixed(2)}</li>
                  <li>Inventory base: {metrics.inventory.base.toFixed(4)}</li>
                  <li>Last ticker: {metrics.lastTickerTs ? formatDate(new Date(metrics.lastTickerTs).toISOString()) : 'n/a'}</li>
                </ul>
              ) : (
                <p style={{ color: '#94a3b8' }}>No runs recorded yet.</p>
              )}
            </div>
          </article>

          <article style={{ background: '#111c2f', padding: '1.75rem', borderRadius: 16 }}>
            <h2 style={{ marginTop: 0 }}>Audit trail</h2>
            {auditEntries.length === 0 ? (
              <p style={{ color: '#94a3b8' }}>No actions logged yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #1e293b' }}>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Action</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Actor</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>When</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map((entry) => (
                    <tr key={entry.id} style={{ borderBottom: '1px solid #1e293b' }}>
                      <td style={{ padding: '0.5rem 0.75rem' }}>{entry.action}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8' }}>{entry.actor}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#94a3b8' }}>{formatDate(entry.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        </section>
      </main>
    </>
  );
}
