import { Gauge } from 'prom-client';

export const analyticsSharpeGauge = new Gauge({
  name: 'analytics_sharpe_ratio',
  help: 'Sharpe ratio over recent runs',
  labelNames: ['client_id'] as const,
});

export const analyticsMaxDrawdownGauge = new Gauge({
  name: 'analytics_max_drawdown_usd',
  help: 'Maximum drawdown in USD over recent runs',
  labelNames: ['client_id'] as const,
});

export const analyticsWinRateGauge = new Gauge({
  name: 'analytics_win_rate',
  help: 'Win rate over recent runs (0-1)',
  labelNames: ['client_id'] as const,
});

export const analyticsSlippageGauge = new Gauge({
  name: 'analytics_avg_slippage_bps',
  help: 'Average slippage in basis points',
  labelNames: ['client_id'] as const,
});

export const analyticsFillRateGauge = new Gauge({
  name: 'analytics_fill_rate_pct',
  help: 'Order fill rate percentage',
  labelNames: ['client_id'] as const,
});
