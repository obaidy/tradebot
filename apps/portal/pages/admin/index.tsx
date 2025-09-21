import Head from 'next/head';
import { useEffect, useState } from 'react';

async function fetchJson(url: string) {
  const res = await fetch(url);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || `Request failed (${res.status})`);
  }
  return res.json();
}

interface BillingRow {
  id: string;
  plan: string;
  status: string;
  trialEndsAt: string | null;
  autoPaused: boolean;
  isPaused: boolean;
  killRequested: boolean;
}

interface SummaryRow {
  id: string;
  plan: string;
  billingStatus: string;
  autoPaused: boolean;
  isPaused: boolean;
  guard: { global_pnl: number; run_pnl: number };
  workers: Record<string, number>;
  runs: { runs: number; last_started: string | null };
}

export default function AdminDashboard() {
  const [billing, setBilling] = useState<BillingRow[]>([]);
  const [summary, setSummary] = useState<{
    totalClients: number;
    pausedClients: number;
    billingIssues: number;
    data: SummaryRow[];
  }>({ totalClients: 0, pausedClients: 0, billingIssues: 0, data: [] });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [billingRes, summaryRes] = await Promise.all([
          fetchJson('/api/admin/billing'),
          fetchJson('/api/admin/summary'),
        ]);
        if (cancelled) return;
        setBilling(billingRes);
        setSummary(summaryRes);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load admin dashboard');
      }
    }
    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return (
    <>
      <Head>
        <title>Admin Dashboard</title>
      </Head>
      <main style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', padding: '2rem 3rem' }}>
        <h1 style={{ marginBottom: '1rem' }}>Operations Dashboard</h1>
        {error ? (
          <div style={{ background: '#7f1d1d', padding: '1rem', borderRadius: 12, marginBottom: '1.5rem' }}>{error}</div>
        ) : null}
        <section style={{ marginBottom: '2rem' }}>
          <h2>Summary</h2>
          <p>Total clients: {summary.totalClients}</p>
          <p>Paused clients: {summary.pausedClients}</p>
          <p>Billing issues: {summary.billingIssues}</p>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                <th style={{ padding: '0.5rem' }}>Client</th>
                <th style={{ padding: '0.5rem' }}>Plan</th>
                <th style={{ padding: '0.5rem' }}>Billing</th>
                <th style={{ padding: '0.5rem' }}>Auto Pause</th>
                <th style={{ padding: '0.5rem' }}>PnL</th>
                <th style={{ padding: '0.5rem' }}>Workers</th>
                <th style={{ padding: '0.5rem' }}>Runs</th>
              </tr>
            </thead>
            <tbody>
              {summary.data.map((row) => (
                <tr key={row.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '0.5rem' }}>{row.id}</td>
                  <td style={{ padding: '0.5rem' }}>{row.plan}</td>
                  <td style={{ padding: '0.5rem' }}>{row.billingStatus}</td>
                  <td style={{ padding: '0.5rem' }}>{row.autoPaused ? 'Yes' : 'No'}</td>
                  <td style={{ padding: '0.5rem' }}>Global {row.guard.global_pnl.toFixed(2)} · Run {row.guard.run_pnl.toFixed(2)}</td>
                  <td style={{ padding: '0.5rem' }}>
                    {Object.entries(row.workers).length === 0
                      ? '—'
                      : Object.entries(row.workers)
                          .map(([status, count]) => `${status}: ${count}`)
                          .join(', ')}
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    {row.runs.runs} runs
                    {row.runs.last_started ? ` · Last ${new Date(row.runs.last_started).toLocaleString()}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2>Billing Status</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '1rem' }}>
            <thead>
              <tr style={{ background: '#1e293b' }}>
                <th style={{ padding: '0.5rem' }}>Client</th>
                <th style={{ padding: '0.5rem' }}>Plan</th>
                <th style={{ padding: '0.5rem' }}>Status</th>
                <th style={{ padding: '0.5rem' }}>Trial Ends</th>
                <th style={{ padding: '0.5rem' }}>Auto Paused</th>
                <th style={{ padding: '0.5rem' }}>Paused</th>
                <th style={{ padding: '0.5rem' }}>Kill Requested</th>
              </tr>
            </thead>
            <tbody>
              {billing.map((row) => (
                <tr key={row.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '0.5rem' }}>{row.id}</td>
                  <td style={{ padding: '0.5rem' }}>{row.plan}</td>
                  <td style={{ padding: '0.5rem' }}>{row.status}</td>
                  <td style={{ padding: '0.5rem' }}>{row.trialEndsAt ? new Date(row.trialEndsAt).toLocaleString() : '—'}</td>
                  <td style={{ padding: '0.5rem' }}>{row.autoPaused ? 'Yes' : 'No'}</td>
                  <td style={{ padding: '0.5rem' }}>{row.isPaused ? 'Yes' : 'No'}</td>
                  <td style={{ padding: '0.5rem' }}>{row.killRequested ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </main>
    </>
  );
}
