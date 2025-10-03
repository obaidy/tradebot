import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';

type HeatmapEntry = {
  assetA: string;
  assetB: string;
  correlation: number;
};

type CorrelationHeatmapProps = {
  data?: HeatmapEntry[];
};

export function CorrelationHeatmap({ data }: CorrelationHeatmapProps) {
  if (!data || data.length === 0) return null;

  const assets = Array.from(
    new Set(data.reduce<string[]>((acc, entry) => acc.concat([entry.assetA, entry.assetB]), []))
  ).sort();

  const grid: Record<string, Record<string, number>> = {};
  for (const assetA of assets) {
    grid[assetA] = {};
    for (const assetB of assets) {
      if (assetA === assetB) {
        grid[assetA][assetB] = 1;
      }
    }
  }
  for (const entry of data) {
    grid[entry.assetA] = grid[entry.assetA] || {};
    grid[entry.assetB] = grid[entry.assetB] || {};
    grid[entry.assetA][entry.assetB] = entry.correlation;
    grid[entry.assetB][entry.assetA] = entry.correlation;
  }

  const intensity = (value: number) => {
    const clamped = Math.max(-1, Math.min(1, value));
    if (clamped >= 0) {
      const pct = Math.round(clamped * 100);
      return `linear-gradient(135deg, rgba(34,197,94,0.35) ${pct}%, rgba(15,118,110,0.1) 100%)`;
    }
    const pct = Math.round(Math.abs(clamped) * 100);
    return `linear-gradient(135deg, rgba(239,68,68,0.35) ${pct}%, rgba(127,29,29,0.1) 100%)`;
  };

  return (
    <Card style={{ padding: '1.5rem', overflowX: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <Badge tone="primary">Market overview</Badge>
          <h2 style={{ margin: '0.5rem 0 0' }}>Correlation matrix</h2>
          <p style={{ margin: 0, color: '#94A3B8' }}>
            Understand how your exposures move together. Deep red = strongly inverse, green = strongly positive.
          </p>
        </div>
      </div>
      <table className="heatmap-table">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Asset</th>
            {assets.map((asset) => (
              <th key={asset}>{asset}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {assets.map((rowAsset) => (
            <tr key={rowAsset}>
              <th style={{ textAlign: 'left' }}>{rowAsset}</th>
              {assets.map((colAsset) => {
                const value = grid[rowAsset][colAsset] ?? 0;
                return (
                  <td
                    key={`${rowAsset}-${colAsset}`}
                    style={{
                      background: intensity(value),
                      textAlign: 'center',
                      fontWeight: rowAsset === colAsset ? 600 : 500,
                    }}
                  >
                    {value.toFixed(2)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
