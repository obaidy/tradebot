import Head from 'next/head';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { palette } from '../styles/theme';
import { usePortalData } from '../hooks/usePortalData';

type BotPreset = 'grid' | 'dca';

export default function OnboardingPage() {
  const router = useRouter();
  const { status } = useSession({ required: true });
  const { data, refresh } = usePortalData({ enabled: status === 'authenticated', allowOnboarding: true });
  const [step, setStep] = useState(1);
  const [exchangeForm, setExchangeForm] = useState({ apiKey: '', apiSecret: '' });
  const [botPreset, setBotPreset] = useState<BotPreset>('grid');
  const [allocation, setAllocation] = useState('500');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const hasExchange = (data?.snapshot?.credentials ?? []).length > 0;
  const hasBot = (data?.bots ?? []).some((bot) => bot.status === 'active');

  useEffect(() => {
    if (hasBot) {
      router.replace('/app');
    } else if (hasExchange) {
      setStep(3);
    }
  }, [hasBot, hasExchange, router]);

  async function handleConnectExchange() {
    try {
      setSaving(true);
      setMessage(null);
      const res = await fetch('/api/client/exchanges/binance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: exchangeForm.apiKey, apiSecret: exchangeForm.apiSecret }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.message || detail.error || 'connect_failed');
      }
      await refresh();
      setStep(3);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to connect exchange');
    } finally {
      setSaving(false);
    }
  }

  async function handleStartBot() {
    try {
      setSaving(true);
      setMessage(null);
      const res = await fetch('/api/client/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: botPreset,
          pair: botPreset === 'grid' ? 'BTC/USDT' : 'ETH/USDT',
          allocationUsd: Number(allocation),
          mode: 'paper',
          riskPreset: 'balanced',
          exchangeId: 'binance',
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || 'bot_failed');
      }
      router.replace('/app');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unable to start bot');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', padding: '4rem 1rem', background: palette.background }}>
      <Head>
        <title>Onboarding · OctoBot Portal</title>
      </Head>
      <div style={{ maxWidth: '720px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <header>
          <Badge tone="primary">Onboarding</Badge>
          <h1 style={{ margin: '0.5rem 0 0' }}>Let’s get you trading</h1>
          <p style={{ margin: '0.35rem 0 0', color: palette.textSecondary }}>
            Three quick steps: welcome, connect Binance, and start your first bot.
          </p>
        </header>

        <Card>
          <ol style={{ margin: 0, paddingLeft: '1.25rem', color: palette.textSecondary }}>
            <li style={{ fontWeight: step === 1 ? 600 : 400 }}>Welcome</li>
            <li style={{ fontWeight: step === 2 ? 600 : 400 }}>Connect exchange</li>
            <li style={{ fontWeight: step === 3 ? 600 : 400 }}>Start first bot</li>
          </ol>
        </Card>

        {step === 1 ? (
          <Card style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <h2 style={{ margin: 0 }}>Welcome aboard</h2>
            <p style={{ color: palette.textSecondary }}>
              You control your exchange keys. We only place spot trades through the bots you enable. Withdrawals should
              stay disabled on Binance.
            </p>
            <Button onClick={() => setStep(2)}>Next</Button>
          </Card>
        ) : null}

        {step === 2 ? (
          <Card style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <h2 style={{ margin: 0 }}>Connect Binance</h2>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span>API Key</span>
              <input
                type="text"
                value={exchangeForm.apiKey}
                onChange={(event) => setExchangeForm((prev) => ({ ...prev, apiKey: event.target.value }))}
                style={{ padding: '0.6rem', borderRadius: '10px' }}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span>API Secret</span>
              <input
                type="password"
                value={exchangeForm.apiSecret}
                onChange={(event) => setExchangeForm((prev) => ({ ...prev, apiSecret: event.target.value }))}
                style={{ padding: '0.6rem', borderRadius: '10px' }}
              />
            </label>
            {message ? <p style={{ color: palette.danger }}>{message}</p> : null}
            <Button onClick={handleConnectExchange} disabled={!exchangeForm.apiKey || !exchangeForm.apiSecret || saving}>
              {saving ? 'Verifying…' : 'Connect'}
            </Button>
          </Card>
        ) : null}

        {step === 3 ? (
          <Card style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            <h2 style={{ margin: 0 }}>Choose your first bot</h2>
            <div style={{ display: 'flex', gap: '1rem' }}>
              {['grid', 'dca'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setBotPreset(preset as BotPreset)}
                  style={{
                    flex: 1,
                    padding: '1rem',
                    borderRadius: '12px',
                    border: botPreset === preset ? '2px solid #22D3EE' : '1px solid rgba(148,163,184,0.4)',
                    background: 'transparent',
                    color: 'inherit',
                    cursor: 'pointer',
                  }}
                >
                  <strong style={{ display: 'block', marginBottom: '0.35rem' }}>
                    {preset === 'grid' ? 'Grid Bot' : 'DCA Bot'}
                  </strong>
                  <span style={{ color: palette.textSecondary }}>
                    {preset === 'grid' ? 'Chop-friendly limit orders' : 'Steady accumulation'}
                  </span>
                </button>
              ))}
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span>Allocation (USDT)</span>
              <input
                type="number"
                value={allocation}
                onChange={(event) => setAllocation(event.target.value)}
                min="100"
                step="50"
                style={{ padding: '0.6rem', borderRadius: '10px' }}
              />
            </label>
            {message && step === 3 ? <p style={{ color: palette.danger }}>{message}</p> : null}
            <Button onClick={handleStartBot} disabled={saving}>
              {saving ? 'Starting…' : 'Launch bot'}
            </Button>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
