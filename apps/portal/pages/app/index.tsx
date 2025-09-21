import Head from 'next/head';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';

const REQUIRED_DOCUMENTS = [
  {
    key: 'tos',
    label: 'Terms of Service',
    version: process.env.NEXT_PUBLIC_TOS_VERSION || '2025-01-01',
    slug: 'terms',
  },
  {
    key: 'privacy',
    label: 'Privacy Policy',
    version: process.env.NEXT_PUBLIC_PRIVACY_VERSION || '2025-01-01',
    slug: 'privacy',
  },
  {
    key: 'risk',
    label: 'Risk Disclosure',
    version: process.env.NEXT_PUBLIC_RISK_VERSION || '2025-01-01',
    slug: 'risk',
  },
];

type Plan = {
  id: string;
  name: string;
  description: string;
  priceUsd: number;
  features: string[];
  limits: {
    maxSymbols: number;
    allowLiveTrading: boolean;
    paperOnly: boolean;
    allowedExchanges: string[];
    maxPerTradeUsd: number;
    maxExposureUsd: number;
    maxDailyVolumeUsd: number;
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

function formatTrialCountdown(trialEndsAt: string | null) {
  if (!trialEndsAt) return null;
  const ending = new Date(trialEndsAt).getTime();
  const now = Date.now();
  const diffMs = ending - now;
  if (diffMs <= 0) return 'Expired';
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  const diffHours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (diffDays > 0) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ${diffHours}h remaining`;
  }
  const diffMinutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
  return `${diffHours}h ${diffMinutes}m remaining`;
}

function applyClientSnapshotState(
  snapshot: any,
  opts: {
    setClientState: (state: { isPaused: boolean; killRequested: boolean }) => void;
    setBillingInfo: (
      info: {
        status: string;
        trialEndsAt: string | null;
        planId: string;
        trialExpired: boolean;
        autoPaused: boolean;
      }
    ) => void;
  }
) {
  const clientSnapshot = snapshot?.client ?? {};
  const planId = (clientSnapshot.plan ?? clientSnapshot.planId) || 'starter';
  const trialEndsRaw = clientSnapshot.trialEndsAt ?? clientSnapshot.trial_ends_at ?? null;
  const trialEndsIso = trialEndsRaw ? new Date(trialEndsRaw).toISOString() : null;
  const billingStatus = clientSnapshot.billingStatus ?? clientSnapshot.billing_status ?? 'trialing';
  const trialExpired =
    billingStatus === 'trialing' && trialEndsIso ? new Date(trialEndsIso).getTime() <= Date.now() : false;
  const autoPaused = Boolean(clientSnapshot.billingAutoPaused ?? clientSnapshot.billing_auto_paused);
  opts.setBillingInfo({
    status: billingStatus,
    trialEndsAt: trialEndsIso,
    planId,
    trialExpired,
    autoPaused,
  });
  opts.setClientState({
    isPaused: Boolean(clientSnapshot.isPaused ?? clientSnapshot.is_paused),
    killRequested: Boolean(clientSnapshot.killRequested ?? clientSnapshot.kill_requested),
  });
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
  const [credentials, setCredentials] = useState<any[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [workers, setWorkers] = useState<any[]>([]);
  const [clientState, setClientState] = useState<{ isPaused: boolean; killRequested: boolean }>({
    isPaused: false,
    killRequested: false,
  });
  const [apiForm, setApiForm] = useState({ exchangeName: 'binance', apiKey: '', apiSecret: '', passphrase: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [billingInfo, setBillingInfo] = useState<{
    status: string;
    trialEndsAt: string | null;
    planId: string;
    trialExpired: boolean;
    autoPaused: boolean;
  }>({
    status: 'trialing',
    trialEndsAt: null,
    planId: 'starter',
    trialExpired: false,
    autoPaused: false,
  });
  const [processingCheckout, setProcessingCheckout] = useState(false);
  const [agreements, setAgreements] = useState<any[]>([]);
  const [agreementRequirements, setAgreementRequirements] = useState<any[]>([]);
  const [ackChecklist, setAckChecklist] = useState<Record<string, boolean>>({});
  const [runHistory, setRunHistory] = useState<any[]>([]);
  const [guardSnapshot, setGuardSnapshot] = useState<any | null>(null);
  const [inventoryHistory, setInventoryHistory] = useState<any[]>([]);

  const clientId = session?.user?.id;
  const actor = useMemo(() => session?.user?.email ?? clientId ?? 'unknown', [session?.user?.email, clientId]);

  const requiredDocumentsStatus = useMemo(() => {
    return REQUIRED_DOCUMENTS.map((doc) => {
      const requirement = agreementRequirements.find((req: any) => req.documentType === doc.key);
      return {
        ...doc,
        accepted: Boolean(requirement?.accepted),
        acceptedAt: requirement?.acceptedAt ?? null,
      };
    });
  }, [agreementRequirements]);

  const pendingDocuments = useMemo(() => requiredDocumentsStatus.filter((doc) => !doc.accepted), [requiredDocumentsStatus]);
  const needsAgreement = pendingDocuments.length > 0;

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
        const [plansRes, snapshot, credsRes, auditRes, metricsRes, workersRes, historyRes, agreementsRes] = await Promise.all([
          fetchJson('/api/client/plans'),
          fetchJson('/api/client/snapshot'),
          fetchJson('/api/client/credentials'),
          fetchJson('/api/client/audit'),
          fetchJson('/api/client/metrics').catch(() => null),
          fetchJson('/api/client/workers').catch(() => []),
          fetchJson('/api/client/history').catch(() => null),
          fetchJson('/api/client/agreements').catch(() => null),
        ]);
        if (cancelled) return;
        setPlans(plansRes);
        applyClientSnapshotState(snapshot, {
          setClientState,
          setBillingInfo,
        });
        setCredentials(credsRes);
        setAuditEntries(auditRes);
        setMetrics(metricsRes);
        setWorkers(workersRes);
        setRunHistory(historyRes?.runs ?? []);
        setGuardSnapshot(historyRes?.guard ?? null);
        setInventoryHistory(historyRes?.inventory ?? []);
        setAgreements(agreementsRes?.agreements ?? []);
        setAgreementRequirements(agreementsRes?.requirements ?? []);
        setAckChecklist((prev) => {
          const next = { ...prev };
          const accepted = new Set(
            (agreementsRes?.requirements ?? [])
              .filter((req: any) => req.accepted)
              .map((req: any) => req.documentType)
          );
          REQUIRED_DOCUMENTS.forEach((doc) => {
            if (accepted.has(doc.key)) {
              next[doc.key] = true;
            }
          });
          return next;
        });
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const checkoutStatus = params.get('checkout');
    if (checkoutStatus === 'success') {
      setMessage('Subscription updated successfully.');
      params.delete('checkout');
      const newSearch = params.toString();
      const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}`;
      window.history.replaceState({}, '', newUrl);
      refreshSnapshot().catch(() => {});
    } else if (checkoutStatus === 'cancelled') {
      setMessage('Checkout cancelled. No changes were made.');
      params.delete('checkout');
      const newSearch = params.toString();
      const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ''}`;
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  async function handlePlanCheckout(planId: string) {
    try {
      setProcessingCheckout(true);
      setMessage(null);
      setError(null);
      const checkout = await fetchJson('/api/client/billing/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
      });
      if (checkout?.url) {
        if (typeof window !== 'undefined') {
          window.location.href = checkout.url;
        }
        return;
      }
      setMessage('Checkout created. Follow the instructions in the opened window.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Billing session failed');
    } finally {
      setProcessingCheckout(false);
    }
  }

  async function refreshSnapshot() {
    const snapshot = await fetchJson('/api/client/snapshot');
    applyClientSnapshotState(snapshot, {
      setClientState,
      setBillingInfo,
    });
    const history = await fetchJson('/api/client/history');
    setRunHistory(history?.runs ?? []);
    setGuardSnapshot(history?.guard ?? null);
    setInventoryHistory(history?.inventory ?? []);
    const agreementsRes = await fetchJson('/api/client/agreements');
    setAgreements(agreementsRes?.agreements ?? []);
    setAgreementRequirements(agreementsRes?.requirements ?? []);
    setAckChecklist((prev) => {
      const next = { ...prev };
      const accepted = new Set(
        (agreementsRes?.requirements ?? [])
          .filter((req: any) => req.accepted)
          .map((req: any) => req.documentType)
      );
      REQUIRED_DOCUMENTS.forEach((doc) => {
        if (accepted.has(doc.key)) {
          next[doc.key] = true;
        }
      });
      return next;
    });
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

  async function refreshWorkers() {
    const workerList = await fetchJson('/api/client/workers').catch(() => []);
    setWorkers(workerList);
    try {
      await refreshSnapshot();
    } catch {
      // ignore snapshot refresh failures; existing state remains
    }
  }

  async function handleAcceptDocuments() {
    try {
      setError(null);
      const documents = pendingDocuments.map((doc) => ({ documentType: doc.key, version: doc.version }));
      await fetchJson('/api/client/agreements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents }),
      });
      setMessage('Thank you for accepting the latest terms.');
      setAckChecklist({});
      await refreshSnapshot();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'agreement_accept_failed');
    }
  }

  async function handlePause() {
    try {
      setMessage(null);
      setError(null);
      await fetchJson('/api/client/pause', { method: 'POST' });
      setClientState((prev) => ({ ...prev, isPaused: true }));
      await refreshAudit();
      await refreshWorkers();
      setMessage('Client paused');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pause failed');
    }
  }

  async function handleResume() {
    try {
      setMessage(null);
      setError(null);
      await fetchJson('/api/client/resume', { method: 'POST' });
      setClientState((prev) => ({ ...prev, isPaused: false }));
      await refreshAudit();
      await refreshWorkers();
      setMessage('Client resumed');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resume failed');
    }
  }

  async function handleKill() {
    try {
      setMessage(null);
      setError(null);
      await fetchJson('/api/client/kill', { method: 'POST' });
      setClientState({ isPaused: true, killRequested: true });
      await refreshAudit();
      await refreshWorkers();
      setMessage('Kill request sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kill request failed');
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
              {plans.map((plan) => {
                const isCurrent = billingInfo.planId === plan.id;
                const label = isCurrent ? 'Manage billing' : 'Upgrade';
                return (
                  <div
                    key={plan.id}
                    style={{
                      padding: '1rem 1.25rem',
                      borderRadius: 12,
                      border: isCurrent ? '2px solid #38bdf8' : '1px solid #1e293b',
                      background: isCurrent ? '#0b1730' : 'transparent',
                      color: '#e2e8f0',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong>{plan.name}</strong>
                        {isCurrent ? (
                          <span style={{ marginLeft: '0.75rem', fontSize: '0.9rem', color: '#38bdf8' }}>
                            Current plan
                          </span>
                        ) : null}
                      </div>
                      <span>${plan.priceUsd}/mo</span>
                    </div>
                    <p style={{ color: '#94a3b8' }}>{plan.description}</p>
                    <ul style={{ margin: 0, paddingLeft: '1.2rem', color: '#cbd5f5' }}>
                      {plan.features.map((feature) => (
                        <li key={feature}>{feature}</li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => handlePlanCheckout(plan.id)}
                      disabled={processingCheckout}
                      style={{
                        marginTop: '1rem',
                        padding: '0.65rem 1.1rem',
                        borderRadius: 10,
                        border: 'none',
                        background: '#2563eb',
                        color: '#fff',
                        fontWeight: 600,
                        cursor: processingCheckout ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {processingCheckout ? 'Opening checkout…' : label}
                    </button>
                  </div>
                );
              })}
            </div>
          </article>

          <article style={{ background: '#111c2f', padding: '1.75rem', borderRadius: 16 }}>
            <h2 style={{ marginTop: 0 }}>Billing status</h2>
            <p style={{ color: '#cbd5f5', marginBottom: '0.5rem' }}>
              Status: <strong>{billingInfo.status}</strong>
            </p>
            <p style={{ color: '#94a3b8', marginBottom: '0.5rem' }}>
              Current plan: <strong>{billingInfo.planId}</strong>
            </p>
            <p style={{ color: billingInfo.trialExpired ? '#f87171' : '#94a3b8' }}>
              Trial: {billingInfo.trialEndsAt ? formatTrialCountdown(billingInfo.trialEndsAt) : 'Not set'}
            </p>
            {billingInfo.trialExpired && billingInfo.status === 'trialing' ? (
              <p style={{ color: '#f87171' }}>
                Your trial has ended. Start a subscription to resume live runs.
              </p>
            ) : null}
            {billingInfo.autoPaused ? (
              <p style={{ color: '#fbbf24' }}>
                Billing pause is active. Workers will automatically resume once payment is confirmed.
              </p>
            ) : null}
            {!['active', 'trialing', 'past_due'].includes(billingInfo.status) ? (
              <p style={{ color: '#f87171' }}>
                Subscription inactive. Workers stay paused until billing is restored.
              </p>
            ) : null}
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

          <article style={{ background: '#111c2f', padding: '1.75rem', borderRadius: 16 }}>
            <h2 style={{ marginTop: 0 }}>Runner controls</h2>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={handlePause}
                disabled={clientState.isPaused}
                style={{
                  padding: '0.6rem 1rem',
                  borderRadius: 10,
                  border: '1px solid #1e40af',
                  background: clientState.isPaused ? '#1f2937' : '#1d4ed8',
                  color: '#e2e8f0',
                  cursor: clientState.isPaused ? 'not-allowed' : 'pointer',
                }}
              >
                Pause
              </button>
              <button
                type="button"
                onClick={handleResume}
                disabled={!clientState.isPaused || clientState.killRequested || billingInfo.autoPaused}
                style={{
                  padding: '0.6rem 1rem',
                  borderRadius: 10,
                  border: '1px solid #16a34a',
                  background:
                    !clientState.isPaused || billingInfo.autoPaused ? '#1f2937' : '#22c55e',
                  color: '#111827',
                  cursor:
                    !clientState.isPaused || billingInfo.autoPaused ? 'not-allowed' : 'pointer',
                }}
              >
                Resume
              </button>
              <button
                type="button"
                onClick={handleKill}
                disabled={clientState.killRequested}
                style={{
                  padding: '0.6rem 1rem',
                  borderRadius: 10,
                  border: '1px solid #f87171',
                  background: clientState.killRequested ? '#1f2937' : '#f87171',
                  color: '#111827',
                  cursor: clientState.killRequested ? 'not-allowed' : 'pointer',
                }}
              >
                Kill
              </button>
            </div>
            <div style={{ marginTop: '1rem' }}>
              <p style={{ color: '#94a3b8' }}>
                Runner paused: {clientState.isPaused ? 'Yes' : 'No'} · Kill requested: {clientState.killRequested ? 'Yes' : 'No'}
              </p>
              {workers.length === 0 ? (
                <p style={{ color: '#94a3b8' }}>No workers registered.</p>
              ) : (
                <ul style={{ lineHeight: 1.7, color: '#cbd5f5' }}>
                  {workers.map((worker) => {
                    const id = (worker.workerId ?? worker.worker_id) as string;
                    const status = worker.status ?? worker.status;
                    const lastHeartbeatRaw = worker.lastHeartbeat ?? worker.last_heartbeat;
                    const metadata = (worker.metadata ?? worker.metadata) as Record<string, any> | null;
                    const queueDepth = typeof metadata?.queueDepth === 'number' ? metadata.queueDepth : undefined;
                    const lastError = metadata?.lastError as
                      | { message?: string; failedAt?: string; jobId?: string; stack?: string }
                      | undefined;
                    return (
                      <li key={id} style={{ marginBottom: '0.5rem' }}>
                        {id} — {status}
                        {lastHeartbeatRaw ? ` (last heartbeat ${formatDate(lastHeartbeatRaw)})` : ''}
                        {queueDepth !== undefined ? ` · Queue depth ${queueDepth}` : ''}
                        {lastError?.message ? (
                          <div style={{ color: '#f87171', fontSize: '0.9rem', marginTop: '0.25rem' }}>
                            Last error: {lastError.message}
                            {lastError.jobId ? ` (job ${lastError.jobId})` : ''}
                            {lastError.failedAt ? ` at ${formatDate(lastError.failedAt)}` : ''}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </article>

          <article style={{ background: '#111c2f', padding: '1.75rem', borderRadius: 16 }}>
            <h2 style={{ marginTop: 0 }}>Performance history</h2>
            <div style={{ marginBottom: '1.25rem' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>Recent runs</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #1e293b' }}>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Run ID</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Started</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Status</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Mode</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Est. Net PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {runHistory.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '0.75rem', color: '#94a3b8' }}>
                        No runs recorded yet.
                      </td>
                    </tr>
                  ) : (
                    runHistory.slice(0, 10).map((run) => (
                      <tr key={run.runId} style={{ borderBottom: '1px solid #1e293b' }}>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{run.runId}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          {run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{run.status}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{run.runMode}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          {run.estNetProfit !== null && run.estNetProfit !== undefined
                            ? run.estNetProfit.toFixed(4)
                            : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <h3 style={{ marginBottom: '0.5rem' }}>Guard snapshot</h3>
              {guardSnapshot ? (
                <ul style={{ lineHeight: 1.7, color: '#cbd5f5' }}>
                  <li>Global PnL: {guardSnapshot.globalPnl.toFixed(2)}</li>
                  <li>Run PnL: {guardSnapshot.runPnl.toFixed(2)}</li>
                  <li>Inventory Base: {guardSnapshot.inventoryBase.toFixed(4)}</li>
                  <li>Inventory Cost: {guardSnapshot.inventoryCost.toFixed(2)}</li>
                  <li>
                    Last ticker: {guardSnapshot.lastTickerTs ? new Date(guardSnapshot.lastTickerTs).toLocaleString() : '—'}
                  </li>
                  <li>API errors (60s): {guardSnapshot.apiErrorsLastMinute}</li>
                </ul>
              ) : (
                <p style={{ color: '#94a3b8' }}>No guard data yet.</p>
              )}
            </div>

            <div>
              <h3 style={{ marginBottom: '0.5rem' }}>Inventory history</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #1e293b' }}>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Timestamp</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Base</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Quote</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Exposure USD</th>
                  </tr>
                </thead>
                <tbody>
                  {inventoryHistory.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: '0.75rem', color: '#94a3b8' }}>
                        No inventory snapshots yet.
                      </td>
                    </tr>
                  ) : (
                    inventoryHistory.slice(0, 10).map((snapshot) => (
                      <tr key={snapshot.snapshotTime} style={{ borderBottom: '1px solid #1e293b' }}>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          {snapshot.snapshotTime ? new Date(snapshot.snapshotTime).toLocaleString() : '—'}
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{snapshot.baseBalance.toFixed(6)}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>{snapshot.quoteBalance.toFixed(2)}</td>
                        <td style={{ padding: '0.5rem 0.75rem' }}>
                          {snapshot.exposureUsd !== null ? snapshot.exposureUsd.toFixed(2) : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </article>
        </section>
      </main>
      {needsAgreement ? (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.95)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            zIndex: 9999,
          }}
        >
          <div
            style={{
              maxWidth: 520,
              width: '100%',
              background: '#111c2f',
              padding: '2.5rem',
              borderRadius: 18,
              boxShadow: '0 25px 80px rgba(15,23,42,0.45)',
            }}
          >
            <h2 style={{ marginTop: 0 }}>Accept updated terms</h2>
            <p style={{ color: '#94a3b8' }}>
              Please review and accept the latest customer agreements before continuing. Links open in a new tab.
            </p>
            <div style={{ display: 'grid', gap: '0.75rem', margin: '1.5rem 0' }}>
              {pendingDocuments.map((doc) => (
                <label key={doc.key} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <input
                    type="checkbox"
                    checked={ackChecklist[doc.key] || false}
                    onChange={(event) =>
                      setAckChecklist((prev) => ({ ...prev, [doc.key]: event.target.checked }))
                    }
                    style={{ marginTop: '0.3rem' }}
                  />
                  <span>
                    I have read and agree to the{' '}
                    <a href={`/legal/${doc.slug}`} target="_blank" rel="noopener noreferrer">
                      {doc.label} (v{doc.version})
                    </a>
                  </span>
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={handleAcceptDocuments}
              disabled={!pendingDocuments.every((doc) => ackChecklist[doc.key])}
              style={{
                width: '100%',
                padding: '0.85rem 1.1rem',
                borderRadius: 12,
                border: 'none',
                fontWeight: 600,
                background: pendingDocuments.every((doc) => ackChecklist[doc.key]) ? '#22c55e' : '#1f2937',
                color: pendingDocuments.every((doc) => ackChecklist[doc.key]) ? '#0f172a' : '#475569',
                cursor: pendingDocuments.every((doc) => ackChecklist[doc.key]) ? 'pointer' : 'not-allowed',
              }}
            >
              Accept and continue
            </button>
            <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#94a3b8' }}>
              By proceeding you acknowledge that trading involves risk and no performance is guaranteed.
            </p>
          </div>
        </div>
      ) : null}
      <footer style={{ padding: '1.5rem 3rem', background: '#0b1220', color: '#94a3b8', fontSize: '0.85rem' }}>
        TradeBot provides tooling for self-directed traders. Nothing here constitutes investment advice. You are solely
        responsible for complying with applicable regulations and for any losses incurred.
      </footer>
    </>
  );
}
