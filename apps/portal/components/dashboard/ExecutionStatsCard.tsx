import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

type TradeExecutionStats = {
  avgSlippageBps: number | null;
  medianSlippageBps: number | null;
  fillRatePct: number | null;
  avgFillDurationSec: number | null;
};

type ExecutionStatsCardProps = {
  stats?: TradeExecutionStats | null;
};

export function ExecutionStatsCard({ stats }: ExecutionStatsCardProps) {
  if (!stats) return null;

  const rows = [
    {
      label: 'Average slippage',
      value: stats.avgSlippageBps !== null ? `${stats.avgSlippageBps.toFixed(2)} bps` : '—',
      hint: 'Mean difference between intended and fill prices.',
    },
    {
      label: 'Median slippage',
      value: stats.medianSlippageBps !== null ? `${stats.medianSlippageBps.toFixed(2)} bps` : '—',
      hint: 'Median gives a sense of typical fills and outliers.',
    },
    {
      label: 'Fill rate',
      value: stats.fillRatePct !== null ? `${stats.fillRatePct.toFixed(1)}%` : '—',
      hint: 'Orders that reached full completion.',
    },
    {
      label: 'Avg fill duration',
      value:
        stats.avgFillDurationSec !== null
          ? `${(stats.avgFillDurationSec / 60).toFixed(1)} min`
          : '—',
      hint: 'Mean time from order placement to completion.',
    },
  ];

  return (
    <Card style={{ padding: '1.5rem', display: 'grid', gap: '1rem' }}>
      <div>
        <Badge tone="secondary">Execution analytics</Badge>
        <h2 style={{ margin: '0.5rem 0 0' }}>Trade quality</h2>
        <p style={{ margin: 0, color: '#94A3B8' }}>
          Track slippage, fill rates, and order latency to fine tune your market impact.
        </p>
      </div>
      <div
        style={{
          display: 'grid',
          gap: '1.25rem',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        {rows.map((row) => (
          <div key={row.label} style={{ display: 'grid', gap: '0.25rem' }}>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#64748B', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {row.label}
            </p>
            <p style={{ margin: 0, fontSize: '1.6rem', fontWeight: 600 }}>{row.value}</p>
            <p style={{ margin: 0, color: '#94A3B8' }}>{row.hint}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}
