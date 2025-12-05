import Head from 'next/head';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '../../components/layout/DashboardLayout';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Sparkline } from '../../components/ui/Sparkline';
import { palette } from '../../styles/theme';
import { usePortalData } from '../../hooks/usePortalData';
import type { ClientBot, PortalBootstrap } from '../../types/portal';

type TradesSummary = {
  loading: boolean;
  value: number;
};

function computeAllocationUsd(data: PortalBootstrap | undefined | null) {
  const bots = data?.bots ?? [];
  return bots
    .filter((bot) => bot.status === 'active')
    .reduce((sum, bot) => sum + Number(bot.config?.allocationUsd ?? 0), 0);
}

function countModes(bots: ClientBot[]) {
  const stats = { live: 0, paper: 0 };
  bots.forEach((bot) => {
    const mode = (bot.mode ?? 'paper') as 'live' | 'paper';
    if (mode === 'live') stats.live += 1;
    else stats.paper += 1;
  });
  return stats;
}

function formatUsd(value: number) {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1000) {
    return `$${(value / 1000).toFixed(1)}k`;
  }
  return `$${value.toFixed(2)}`;
}

export default function OverviewPage() {
  const { status } = useSession({ required: true });
  const { data, loading, error, refresh } = usePortalData({ enabled: status === 'authenticated' });
  const [tradesSummary, setTradesSummary] = useState<TradesSummary>({ loading: true, value: 0 });

  const activeBots = useMemo(() => (data?.bots ?? []).filter((bot) => bot.status === 'active'), [data?.bots]);

  const allocationUsd = useMemo(() => computeAllocationUsd(data), [data]);
  const modeCounts = useMemo(() => countModes(activeBots), [activeBots]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let cancelled = false;
    async function loadPnl() {
      setTradesSummary((prev) => ({ ...prev, loading: true }));
      try {
        const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const res = await fetch(`/api/client/trades?start=${encodeURIComponent(start)}&limit=500`);
        if (!res.ok) {
          throw new Error(await res.text());
        }
        const payload = await res.json();
        const sum = Array.isArray(payload.items)
          ? payload.items.reduce((running: number, trade: any) => running + Number(trade.pnlUsd ?? 0), 0)
          : 0;
        if (!cancelled) {
          setTradesSummary({ loading: false, value: sum });
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[portal] trades summary failed', err);
          setTradesSummary({ loading: false, value: 0 });
        }
      }
    }
    loadPnl();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const pnlHistory = useMemo(() => {
    const series = data?.metrics?.pnl?.history ?? [];
    if (series.length) return series;
    return activeBots.length ? activeBots.map((_bot, index) => index * 5) : [];
  }, [data?.metrics?.pnl?.history, activeBots]);

  const needsExchange = (data?.snapshot?.credentials?.length ?? 0) === 0;
  const needsBot = activeBots.length === 0;

  const recentRuns = useMemo(() => {
    return (data?.history?.runs ?? []).slice(0, 5);
  }, [data?.history?.runs]);

  return (
    <DashboardLayout>
      <Head>
        <title>Overview · OctoBot Portal</title>
      </Head>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <header style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <Badge tone="primary">Dashboard</Badge>
          <h1 style={{ margin: 0, fontSize: '2.2rem' }}>At-a-glance</h1>
          <p style={{ margin: 0, color: palette.textSecondary }}>
            Connect your exchange, start a bot, and keep an eye on balances, PnL, and recent runs in one clean view.
          </p>
        </header>
        {error ? (
          <Card style={{ border: '1px solid rgba(248,113,113,0.45)', background: 'rgba(127,29,29,0.2)' }}>
            <h3 style={{ marginTop: 0, color: '#fecaca' }}>Unable to load data</h3>
            <p style={{ color: palette.textSecondary }}>{error.message}</p>
            <Button variant="secondary" onClick={() => refresh()}>
              Retry
            </Button>
          </Card>
        ) : null}
        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1rem',
          }}
        >
          <Card>
            <p style={{ margin: 0, color: palette.textSecondary }}>Total allocated capital</p>
            <h2 style={{ margin: '0.35rem 0 0', fontSize: '2rem' }}>{loading ? '—' : formatUsd(allocationUsd)}</h2>
            <p style={{ margin: '0.35rem 0 0', color: palette.textMuted }}>Active bots: {activeBots.length}</p>
          </Card>
          <Card>
            <p style={{ margin: 0, color: palette.textSecondary }}>24h PnL</p>
            <h2 style={{ margin: '0.35rem 0 0', fontSize: '2rem' }}>
              {tradesSummary.loading ? '—' : formatUsd(tradesSummary.value)}
            </h2>
            <p style={{ margin: '0.35rem 0 0', color: palette.textMuted }}>From trade log</p>
          </Card>
          <Card>
            <p style={{ margin: 0, color: palette.textSecondary }}>Paper vs live</p>
            <h2 style={{ margin: '0.35rem 0 0', fontSize: '2rem' }}>
              {modeCounts.paper} Paper · {modeCounts.live} Live
            </h2>
            <p style={{ margin: '0.35rem 0 0', color: palette.textMuted }}>Per active bot</p>
          </Card>
          <Card>
            <p style={{ margin: 0, color: palette.textSecondary }}>Status</p>
            <h2 style={{ margin: '0.35rem 0 0', fontSize: '2rem' }}>
              {needsExchange ? 'Connect exchange' : needsBot ? 'Start a bot' : 'All clear'}
            </h2>
            <p style={{ margin: '0.35rem 0 0', color: palette.textMuted }}>
              {data?.snapshot?.client?.plan ? `Plan: ${data.snapshot.client.plan}` : 'Plan unknown'}
            </p>
          </Card>
        </section>

        <section style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', flexWrap: 'wrap' }}>
          <Card style={{ minHeight: '260px' }}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <p style={{ margin: 0, color: palette.textSecondary }}>Equity curve</p>
                <h3 style={{ margin: '0.35rem 0 0' }}>Last 30 data points</h3>
              </div>
              <Button variant="secondary" onClick={() => refresh()}>
                Refresh
              </Button>
            </header>
            <div style={{ marginTop: '1rem' }}>
              {pnlHistory.length ? (
                <Sparkline data={pnlHistory} width={520} height={160} animated />
              ) : (
                <p style={{ color: palette.textSecondary }}>No PnL data available yet.</p>
              )}
            </div>
          </Card>
          <Card style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <h3 style={{ margin: 0 }}>Next steps</h3>
            {needsExchange ? (
              <div>
                <p style={{ margin: 0, color: palette.textSecondary }}>Connect Binance to start trading.</p>
                <Link href="/app/exchanges" legacyBehavior>
                  <a>
                    <Button style={{ marginTop: '0.5rem' }}>Connect exchange</Button>
                  </a>
                </Link>
              </div>
            ) : null}
            {!needsExchange && needsBot ? (
              <div>
                <p style={{ margin: 0, color: palette.textSecondary }}>Kick off your first Grid or DCA bot.</p>
                <Link href="/app/bots" legacyBehavior>
                  <a>
                    <Button style={{ marginTop: '0.5rem' }}>Start a bot</Button>
                  </a>
                </Link>
              </div>
            ) : null}
            {!needsExchange && !needsBot ? (
              <p style={{ margin: 0, color: palette.textSecondary }}>All set. Monitor Activity for live trades.</p>
            ) : null}
          </Card>
        </section>

        <section style={{ display: 'grid', gap: '1rem' }}>
          <h3 style={{ marginBottom: 0 }}>Recent runs</h3>
          {recentRuns.length === 0 ? (
            <Card>
              <p style={{ margin: 0, color: palette.textSecondary }}>No runs recorded yet.</p>
            </Card>
          ) : (
            recentRuns.map((run) => (
              <Card key={run.runId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <p style={{ margin: 0, fontWeight: 600 }}>{run.strategyId ?? 'Bot run'}</p>
                  <p style={{ margin: '0.25rem 0 0', color: palette.textSecondary }}>
                    {run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'} · Mode {run.runMode}
                  </p>
                </div>
                <Badge tone={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'warning' : 'neutral'}>
                  {run.status}
                </Badge>
              </Card>
            ))
          )}
        </section>
      </div>
    </DashboardLayout>
  );
}
