import Head from 'next/head';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '../../components/layout/DashboardLayout';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { palette } from '../../styles/theme';
import { usePortalData } from '../../hooks/usePortalData';
import type { ClientBot, StrategySummary } from '../../types/portal';

type Tab = 'available' | 'my';

type BotFormState = {
  strategyId: string;
  pair: string;
  allocationUsd: string;
  mode: 'paper' | 'live';
  riskPreset: 'conservative' | 'balanced' | 'aggressive';
};

const PAIRS: Record<string, string[]> = {
  grid: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
  dca: ['BTC/USDT', 'ETH/USDT', 'ARB/USDT'],
  perp: ['BTC/USDT', 'ETH/USDT'],
};

const RISK_LABELS: Record<BotFormState['riskPreset'], string> = {
  conservative: 'Conservative',
  balanced: 'Balanced',
  aggressive: 'Aggressive',
};

function getPairs(strategyId: string) {
  return PAIRS[strategyId] ?? ['BTC/USDT', 'ETH/USDT'];
}

function formatUsd(value: number | undefined) {
  if (!Number.isFinite(value || 0) || value === undefined) return '—';
  return `$${value.toFixed(2)}`;
}

export default function BotsPage() {
  const { status } = useSession({ required: true });
  const { data, loading, error, refresh } = usePortalData({ enabled: status === 'authenticated' });
  const [activeTab, setActiveTab] = useState<Tab>('available');
  const [configModal, setConfigModal] = useState<BotFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [botPnl24h, setBotPnl24h] = useState<Record<string, number>>({});
  const [totalBotPnl, setTotalBotPnl] = useState<Record<string, number>>({});

  const strategies = useMemo(() => data?.strategies ?? [], [data?.strategies]);
  const bots = useMemo(() => data?.bots ?? [], [data?.bots]);

  useEffect(() => {
    const totals: Record<string, number> = {};
    (data?.history?.runs ?? []).forEach((run) => {
      if (!run.strategyId) return;
      totals[run.strategyId] = (totals[run.strategyId] ?? 0) + (Number(run.estNetProfit) || 0);
    });
    const botsByTemplate = new Map((data?.bots ?? []).map((bot) => [bot.templateKey, bot]));
    Object.entries(totals).forEach(([templateKey, value]) => {
      const matching = botsByTemplate.get(templateKey);
      if (matching) {
        totals[matching.id] = value;
      }
    });
    setTotalBotPnl(totals);
  }, [data?.history?.runs, data?.bots]);

  useEffect(() => {
    let cancelled = false;
    async function loadPnl() {
      const enabledBots = (data?.bots ?? []).filter((bot) => bot.status === 'active');
      if (!enabledBots.length) {
        setBotPnl24h({});
        return;
      }
      const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const entries = await Promise.all(
        enabledBots.map(async (bot) => {
          try {
            const res = await fetch(
              `/api/client/trades?start=${encodeURIComponent(start)}&bot=${encodeURIComponent(bot.id)}`
            );
            if (!res.ok) {
              return [bot.id, 0] as const;
            }
            const payload = await res.json();
            const sum = Array.isArray(payload.items)
              ? payload.items.reduce((acc: number, trade: any) => acc + Number(trade.pnlUsd ?? 0), 0)
              : 0;
            return [bot.id, sum] as const;
          } catch (err) {
            console.warn('[portal] bot pnl load failed', err);
            return [bot.id, 0] as const;
          }
        })
      );
      if (!cancelled) {
        const map: Record<string, number> = {};
        const botIndex = new Map(enabledBots.map((bot) => [bot.id, bot]));
        entries.forEach(([key, value]) => {
          map[key] = value;
          const linked = botIndex.get(key);
          if (linked) {
            map[linked.templateKey] = value;
          }
        });
        setBotPnl24h(map);
      }
    }
    loadPnl();
    return () => {
      cancelled = true;
    };
  }, [data?.bots]);

  function openConfig(strategyId: string) {
    const pairs = getPairs(strategyId);
    setFormError(null);
    setConfigModal({
      strategyId,
      pair: pairs[0],
      allocationUsd: '500',
      mode: 'paper',
      riskPreset: 'balanced',
    });
  }

  async function handleSaveBot() {
    if (!configModal) return;
    try {
      setSaving(true);
      setFormError(null);
      const res = await fetch('/api/client/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strategyId: configModal.strategyId,
          pair: configModal.pair,
          allocationUsd: Number(configModal.allocationUsd),
          mode: configModal.mode,
          riskPreset: configModal.riskPreset,
          exchangeId: 'binance',
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || 'bot_create_failed');
      }
      await refresh();
      setConfigModal(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to start bot');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleBot(bot: ClientBot) {
    const nextStatus = bot.status === 'active' ? 'paused' : 'active';
    try {
      const res = await fetch(`/api/client/bots/${bot.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || 'bot_update_failed');
      }
      await refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Unable to update bot');
    }
  }

  return (
    <DashboardLayout>
      <Head>
        <title>Bots · OctoBot Portal</title>
      </Head>

      <header style={{ marginBottom: '1.5rem' }}>
        <Badge tone="primary">Bots</Badge>
        <h1 style={{ margin: '0.5rem 0 0' }}>Catalog &amp; My bots</h1>
        <p style={{ margin: '0.5rem 0 0', color: palette.textSecondary }}>
          Pick from the available strategies, configure capital, and monitor the bots you already have running.
        </p>
      </header>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        <Button variant={activeTab === 'available' ? 'primary' : 'secondary'} onClick={() => setActiveTab('available')}>
          Available
        </Button>
        <Button variant={activeTab === 'my' ? 'primary' : 'secondary'} onClick={() => setActiveTab('my')}>
          My bots
        </Button>
      </div>

      {activeTab === 'available' ? (
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: '1.5rem',
          }}
        >
          {(strategies as StrategySummary[]).map((strategy) => (
            <Card key={strategy.id} hoverLift>
              <header style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                <div>
                  <h2 style={{ margin: 0 }}>{strategy.name}</h2>
                  <p style={{ margin: '0.35rem 0 0', color: palette.textSecondary }}>{strategy.description}</p>
                </div>
                <Badge tone={strategy.status === 'active' ? 'success' : strategy.status === 'beta' ? 'secondary' : 'neutral'}>
                  {strategy.status === 'active' ? 'Live' : strategy.status === 'beta' ? 'Beta' : 'Soon'}
                </Badge>
              </header>
              <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <p style={{ margin: 0 }}>
                  <strong>Pairs:</strong> {getPairs(strategy.id).join(', ')}
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Mode:</strong> {strategy.supportsLive ? 'Paper & Live' : 'Paper only'}
                </p>
                <p style={{ margin: 0 }}>
                  <strong>Risk:</strong> {strategy.status === 'beta' ? 'Higher (beta)' : 'Managed presets'}
                </p>
              </div>
              <div style={{ marginTop: '1rem' }}>
                <Button onClick={() => openConfig(strategy.id)} disabled={strategy.status === 'coming_soon'}>
                  Configure &amp; Start
                </Button>
              </div>
            </Card>
          ))}
        </section>
      ) : (
        <section>
          {bots.length === 0 ? (
            <Card>
              <p style={{ margin: 0, color: palette.textSecondary }}>No bots yet. Start one from the catalog tab.</p>
            </Card>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {bots.map((bot) => {
                const pnl24 = botPnl24h[bot.id] ?? botPnl24h[bot.templateKey] ?? 0;
                const totalPnl = totalBotPnl[bot.id] ?? totalBotPnl[bot.templateKey] ?? 0;
                const mode = (bot.mode ?? 'paper') as 'paper' | 'live';
                const pair = typeof bot.config?.pair === 'string' ? bot.config?.pair : bot.symbol;
                const allocationDisplay = formatUsd(
                  typeof bot.config?.allocationUsd === 'number'
                    ? bot.config.allocationUsd
                    : Number(bot.config?.allocationUsd ?? 0)
                );
                const statusTone = bot.status === 'active' ? 'success' : bot.status === 'paused' ? 'warning' : 'neutral';
                return (
                  <Card key={bot.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: '1rem' }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600 }}>{bot.templateKey.toUpperCase()}</p>
                      <p style={{ margin: '0.25rem 0 0', color: palette.textSecondary }}>
                        Pair: {pair ?? '—'} · Mode: {mode}
                      </p>
                      <p style={{ margin: '0.15rem 0 0', color: palette.textSecondary }}>Allocation: {allocationDisplay}</p>
                    </div>
                    <div>
                      <p style={{ margin: 0, color: palette.textSecondary }}>Status</p>
                      <Badge tone={statusTone}>{bot.status}</Badge>
                    </div>
                    <div>
                      <p style={{ margin: 0, color: palette.textSecondary }}>24h PnL</p>
                      <p style={{ margin: '0.25rem 0 0' }}>{formatUsd(pnl24)}</p>
                    </div>
                    <div>
                      <p style={{ margin: 0, color: palette.textSecondary }}>Total PnL</p>
                      <p style={{ margin: '0.25rem 0 0' }}>{formatUsd(totalPnl)}</p>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', justifyContent: 'flex-end' }}>
                      <Button variant="secondary" onClick={() => handleToggleBot(bot)}>
                        {bot.status === 'active' ? 'Pause' : 'Resume'}
                      </Button>
                      <Link href={`/app/activity?bot=${encodeURIComponent(bot.id)}`} legacyBehavior>
                        <a style={{ fontSize: '0.85rem', color: palette.primary }}>View</a>
                      </Link>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </section>
      )}

      {configModal ? (
        <>
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(2,6,23,0.75)',
              zIndex: 20,
            }}
            onClick={() => setConfigModal(null)}
          />
          <Card
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'min(420px, 90vw)',
              zIndex: 30,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
            }}
          >
            <h2 style={{ margin: 0 }}>Configure bot</h2>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span>Pair</span>
              <select
                value={configModal.pair}
                onChange={(event) => setConfigModal((prev) => (prev ? { ...prev, pair: event.target.value } : prev))}
                style={{ padding: '0.5rem', borderRadius: '8px' }}
              >
                {getPairs(configModal.strategyId).map((pair) => (
                  <option key={pair} value={pair}>
                    {pair}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span>Allocation (USDT)</span>
              <input
                type="number"
                value={configModal.allocationUsd}
                min="50"
                step="50"
                onChange={(event) =>
                  setConfigModal((prev) => (prev ? { ...prev, allocationUsd: event.target.value } : prev))
                }
                style={{ padding: '0.5rem', borderRadius: '8px' }}
              />
            </label>
            <div>
              <span style={{ display: 'block', marginBottom: '0.25rem' }}>Mode</span>
              <p style={{ margin: 0, color: palette.textSecondary }}>Paper (live coming soon)</p>
            </div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <span>Risk preset</span>
              <select
                value={configModal.riskPreset}
                onChange={(event) =>
                  setConfigModal((prev) => (prev ? { ...prev, riskPreset: event.target.value as BotFormState['riskPreset'] } : prev))
                }
                style={{ padding: '0.5rem', borderRadius: '8px' }}
              >
                {Object.entries(RISK_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {formError ? <p style={{ color: palette.danger, margin: 0 }}>{formError}</p> : null}
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => setConfigModal(null)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleSaveBot} disabled={saving}>
                {saving ? 'Saving…' : 'Start bot'}
              </Button>
            </div>
          </Card>
        </>
      ) : null}
    </DashboardLayout>
  );
}
