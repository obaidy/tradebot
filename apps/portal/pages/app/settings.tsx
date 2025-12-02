import Head from 'next/head';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { DashboardLayout } from '../../components/layout/DashboardLayout';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { palette } from '../../styles/theme';
import { usePortalData } from '../../hooks/usePortalData';

export default function SettingsPage() {
  const { data: session, status } = useSession({ required: true });
  const { data } = usePortalData({ enabled: status === 'authenticated' });
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handlePurge() {
    if (
      typeof window !== 'undefined' &&
      !window.confirm('This removes API keys and pauses your account. Continue?')
    ) {
      return;
    }
    try {
      setProcessing(true);
      setMessage(null);
      const res = await fetch('/api/client/account/purge', { method: 'POST' });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || 'Unable to purge account');
      }
      setMessage('Account paused and API keys removed. You can reconnect anytime.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to purge account');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <DashboardLayout>
      <Head>
        <title>Settings · OctoBot Portal</title>
      </Head>
      <header style={{ marginBottom: '1.5rem' }}>
        <Badge tone="primary">Settings</Badge>
        <h1 style={{ margin: '0.5rem 0 0' }}>Profile &amp; safety</h1>
        <p style={{ margin: '0.35rem 0 0', color: palette.textSecondary }}>
          Update your contact info, review locale settings, and nuke access if anything feels off.
        </p>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem' }}>
        <Card>
          <h3 style={{ marginTop: 0 }}>Profile</h3>
          <p style={{ margin: '0.35rem 0 0' }}>
            <strong>Email:</strong> {session?.user?.email ?? 'Unknown'}
          </p>
          <p style={{ margin: '0.35rem 0 0' }}>
            <strong>Language:</strong> English
          </p>
          <p style={{ margin: '0.35rem 0 0' }}>
            <strong>Plan:</strong> {data?.snapshot?.client?.plan ?? 'starter'}
          </p>
        </Card>
        <Card>
          <h3 style={{ marginTop: 0 }}>Security</h3>
          <p style={{ margin: '0.35rem 0 0', color: palette.textSecondary }}>
            Purge exchange keys and pause execution instantly. You can reconnect when ready.
          </p>
          <Button variant="secondary" onClick={handlePurge} disabled={processing}>
            Delete my account &amp; purge API keys
          </Button>
          {message ? <p style={{ color: palette.textSecondary }}>{message}</p> : null}
        </Card>
        <Card>
          <h3 style={{ marginTop: 0 }}>Need help?</h3>
          <p style={{ margin: '0.35rem 0 0', color: palette.textSecondary }}>
            Browse the FAQ or reach us via email if you have compliance or onboarding questions.
          </p>
          <Link href="/app/help" legacyBehavior>
            <a style={{ color: palette.primary }}>Go to Help &amp; Docs →</a>
          </Link>
        </Card>
      </section>
    </DashboardLayout>
  );
}

