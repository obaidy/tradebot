import Head from 'next/head';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { DashboardLayout } from '../../components/layout/DashboardLayout';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { palette } from '../../styles/theme';
import { usePortalData } from '../../hooks/usePortalData';

type ConnectForm = {
  apiKey: string;
  apiSecret: string;
  passphrase: string;
  allowFutures: boolean;
};

export default function ExchangesPage() {
  const { status } = useSession({ required: true });
  const { data, loading, error, refresh } = usePortalData({ enabled: status === 'authenticated' });
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ConnectForm>({ apiKey: '', apiSecret: '', passphrase: '', allowFutures: false });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const credential = (data?.snapshot?.credentials ?? []).find(
    (cred) => cred.exchangeName?.toLowerCase() === 'binance'
  );

  async function handleConnect() {
    try {
      setSaving(true);
      setFormError(null);
      const res = await fetch('/api/client/exchanges/binance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: form.apiKey,
          apiSecret: form.apiSecret,
          passphrase: form.passphrase || undefined,
          allowFutures: form.allowFutures,
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message || detail.error || 'connect_failed');
      }
      await refresh();
      setShowForm(false);
      setForm({ apiKey: '', apiSecret: '', passphrase: '', allowFutures: false });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to connect exchange');
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (typeof window !== 'undefined' && !window.confirm('Disconnect Binance credentials?')) {
      return;
    }
    try {
      const res = await fetch('/api/client/credentials/binance', { method: 'DELETE' });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || 'disconnect_failed');
      }
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Unable to disconnect');
    }
  }

  return (
    <DashboardLayout>
      <Head>
        <title>Exchanges · OctoBot Portal</title>
      </Head>
      <header style={{ marginBottom: '1.5rem' }}>
        <Badge tone="primary">Exchanges</Badge>
        <h1 style={{ margin: '0.5rem 0 0' }}>Connect Binance</h1>
        <p style={{ margin: '0.35rem 0 0', color: palette.textSecondary }}>
          Bring your own API keys. Withdrawals should stay disabled. We only trade on the spot market for v1.
        </p>
      </header>

      {error ? (
        <Card style={{ border: '1px solid rgba(248,113,113,0.45)', marginBottom: '1rem' }}>
          <p style={{ margin: 0, color: palette.danger }}>{error.message}</p>
        </Card>
      ) : null}

      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '0.5rem 0' }}>Exchange</th>
              <th>Status</th>
              <th>Last checked</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '0.75rem 0' }}>Binance</td>
              <td>
                <Badge tone={credential ? 'success' : 'warning'}>{credential ? 'Connected' : 'Not connected'}</Badge>
              </td>
              <td>{credential ? new Date(credential.createdAt).toLocaleString() : '—'}</td>
              <td>
                {credential ? (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <Button variant="secondary" onClick={() => setShowForm(true)}>
                      Rotate keys
                    </Button>
                    <Button variant="ghost" onClick={handleDisconnect}>
                      Disconnect
                    </Button>
                  </div>
                ) : (
                  <Button onClick={() => setShowForm(true)}>Connect Binance</Button>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </Card>

      {showForm ? (
        <>
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(2,6,23,0.75)',
              zIndex: 20,
            }}
            onClick={() => (!saving ? setShowForm(false) : null)}
          />
          <Card
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'min(500px, 92vw)',
              zIndex: 30,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.85rem',
            }}
          >
            <h2 style={{ margin: 0 }}>Connect Binance</h2>
            <p style={{ margin: 0, color: palette.textSecondary }}>
              Use spot-only keys. Withdrawals should be disabled. We verify the keys before storing them.
            </p>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span>API Key</span>
              <input
                type="text"
                value={form.apiKey}
                onChange={(event) => setForm((prev) => ({ ...prev, apiKey: event.target.value }))}
                style={{ padding: '0.6rem', borderRadius: '10px' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span>API Secret</span>
              <input
                type="password"
                value={form.apiSecret}
                onChange={(event) => setForm((prev) => ({ ...prev, apiSecret: event.target.value }))}
                style={{ padding: '0.6rem', borderRadius: '10px' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span>Passphrase (optional)</span>
              <input
                type="text"
                value={form.passphrase}
                onChange={(event) => setForm((prev) => ({ ...prev, passphrase: event.target.value }))}
                style={{ padding: '0.6rem', borderRadius: '10px' }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <input
                type="checkbox"
                checked={form.allowFutures}
                onChange={(event) => setForm((prev) => ({ ...prev, allowFutures: event.target.checked }))}
              />
              <span>Allow futures trading (disabled in v1)</span>
            </label>
            {formError ? <p style={{ color: palette.danger, margin: 0 }}>{formError}</p> : null}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => setShowForm(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleConnect} disabled={saving || !form.apiKey || !form.apiSecret}>
                {saving ? 'Verifying…' : 'Save'}
              </Button>
            </div>
          </Card>
        </>
      ) : null}
    </DashboardLayout>
  );
}

