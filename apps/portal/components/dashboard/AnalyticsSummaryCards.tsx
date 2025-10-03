import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

type AnalyticsSummaryCardsProps = {
  performance?: {
    runCount: number;
    totalNetPnlUsd: number;
    avgNetPnlUsd: number;
    sharpeRatio: number | null;
    maxDrawdownUsd: number | null;
    winRate: number | null;
    avgHoldingHours: number | null;
  } | null;
};

export function AnalyticsSummaryCards({ performance }: AnalyticsSummaryCardsProps) {
  if (!performance) return null;
  const cards = [
    {
      label: 'Sharpe ratio',
      value: performance.sharpeRatio !== null ? performance.sharpeRatio.toFixed(2) : '—',
      description: 'Risk-adjusted returns over the selected window.',
    },
    {
      label: 'Max drawdown',
      value:
        performance.maxDrawdownUsd !== null
          ? `$${Math.abs(performance.maxDrawdownUsd).toFixed(2)}`
          : '—',
      description: 'Peak-to-trough loss in the period.',
    },
    {
      label: 'Win rate',
      value: performance.winRate !== null ? `${(performance.winRate * 100).toFixed(1)}%` : '—',
      description: 'Percentage of profitable runs.',
    },
    {
      label: 'Avg holding time',
      value:
        performance.avgHoldingHours !== null
          ? `${performance.avgHoldingHours.toFixed(1)}h`
          : '—',
      description: 'Average runtime from entry to exit.',
    },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gap: '1.5rem',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      }}
    >
      {cards.map((card) => (
        <Card key={card.label} style={{ padding: '1.5rem', display: 'grid', gap: '0.5rem' }}>
          <Badge tone="secondary">Performance</Badge>
          <h3 style={{ margin: '0.35rem 0 0' }}>{card.label}</h3>
          <p style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700 }}>{card.value}</p>
          <p style={{ margin: 0, color: '#94A3B8' }}>{card.description}</p>
        </Card>
      ))}
    </div>
  );
}
