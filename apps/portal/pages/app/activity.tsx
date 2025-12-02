import Head from 'next/head';
import { useSession } from 'next-auth/react';
import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '../../components/layout/DashboardLayout';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { palette } from '../../styles/theme';
import { usePortalData } from '../../hooks/usePortalData';

type TradeRow = {
  id: number;
  timestamp: string;
  bot: string;
  strategyId: string;
  pair: string;
  side: string;
  amount: number;
  price: number;
  pnlUsd: number;
  cumulativePnlUsd: number;
  mode: string;
};

export default function ActivityPage() {
  const { status } = useSession({ required: true });
  const { data } = usePortalData({ enabled: status === 'authenticated' });
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<{ bot: string; start: string; end: string }>({
    bot: '',
    start: '',
    end: '',
  });

  const bots = useMemo(() => data?.portfolio?.allocations ?? [], [data?.portfolio?.allocations]);

  async function loadTrades(reset = false) {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      params.set('limit', '50');
      if (filters.bot) params.set('bot', filters.bot);
      if (filters.start) params.set('start', new Date(filters.start).toISOString());
      if (filters.end) {
        const end = new Date(filters.end);
        end.setHours(23, 59, 59, 999);
        params.set('end', end.toISOString());
      }
      if (!reset && nextCursor) {
        params.set('cursor', nextCursor);
      }
      const res = await fetch(`/api/client/trades?${params.toString()}`);
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const payload = await res.json();
      setTrades((prev) => (reset ? payload.items : [...prev, ...payload.items]));
      setNextCursor(payload.nextCursor);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load trades');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTrades(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleApplyFilters() {
    setNextCursor(null);
    setTrades([]);
    loadTrades(true);
  }

  const totalPnl = trades.reduce((sum, trade) => sum + Number(trade.pnlUsd ?? 0), 0);

  return (
    <DashboardLayout>
      <Head>
        <title>Activity · OctoBot Portal</title>
      </Head>
      <header style={{ marginBottom: '1.5rem' }}>
        <Badge tone="primary">Activity</Badge>
        <h1 style={{ margin: '0.5rem 0 0' }}>Trade log</h1>
        <p style={{ margin: '0.35rem 0 0', color: palette.textSecondary }}>
          Every fill that hits Binance shows up here. Filter by bot or date and export later if you need spreadsheets.
        </p>
      </header>

      <Card style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span>Bot</span>
          <select
            value={filters.bot}
            onChange={(event) => setFilters((prev) => ({ ...prev, bot: event.target.value }))}
            style={{ padding: '0.6rem', borderRadius: '10px' }}
          >
            <option value="">All</option>
            {bots.map((bot) => (
              <option key={bot.strategyId} value={bot.strategyId}>
                {bot.strategyId}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span>From</span>
          <input
            type="date"
            value={filters.start}
            onChange={(event) => setFilters((prev) => ({ ...prev, start: event.target.value }))}
            style={{ padding: '0.6rem', borderRadius: '10px' }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          <span>To</span>
          <input
            type="date"
            value={filters.end}
            onChange={(event) => setFilters((prev) => ({ ...prev, end: event.target.value }))}
            style={{ padding: '0.6rem', borderRadius: '10px' }}
          />
        </label>
        <Button onClick={handleApplyFilters} disabled={loading}>
          Apply
        </Button>
      </Card>

      {error ? (
        <Card style={{ border: '1px solid rgba(248,113,113,0.45)', marginBottom: '1rem' }}>
          <p style={{ margin: 0, color: palette.danger }}>{error}</p>
        </Card>
      ) : null}

      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '0.5rem 0' }}>Time</th>
              <th>Bot</th>
              <th>Pair</th>
              <th>Side</th>
              <th>Size</th>
              <th>Price</th>
              <th>PnL</th>
              <th>Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {trades.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '1rem 0', textAlign: 'center', color: palette.textSecondary }}>
                  {loading ? 'Loading…' : 'No trades for this filter.'}
                </td>
              </tr>
            ) : (
              trades.map((trade) => (
                <tr key={`${trade.id}-${trade.timestamp}`}>
                  <td style={{ padding: '0.6rem 0' }}>{new Date(trade.timestamp).toLocaleString()}</td>
                  <td>{trade.bot}</td>
                  <td>{trade.pair}</td>
                  <td>
                    <Badge tone={trade.side === 'SELL' ? 'warning' : 'secondary'}>{trade.side}</Badge>
                  </td>
                  <td>{Number(trade.amount).toFixed(4)}</td>
                  <td>${Number(trade.price).toFixed(2)}</td>
                  <td style={{ color: trade.pnlUsd >= 0 ? palette.success : palette.danger }}>
                    {trade.pnlUsd >= 0 ? '+' : ''}
                    {trade.pnlUsd.toFixed(2)}
                  </td>
                  <td>{trade.cumulativePnlUsd.toFixed(2)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ margin: 0 }}>Total PnL: {totalPnl.toFixed(2)} USDT</p>
          {nextCursor ? (
            <Button variant="secondary" onClick={() => loadTrades(false)} disabled={loading}>
              {loading ? 'Loading…' : 'Load more'}
            </Button>
          ) : null}
        </div>
      </Card>
    </DashboardLayout>
  );
}

