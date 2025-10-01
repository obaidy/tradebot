import http from 'http';
import { Counter, Gauge, Histogram, register } from 'prom-client';

const metricsRegistered: { started: boolean } = { started: false };

export const orderReplacementCounter = new Counter({
  name: 'orders_replaced_total',
  help: 'Count of order replacements by side',
  labelNames: ['client_id', 'side'] as const,
});

export const orderCancelCounter = new Counter({
  name: 'orders_cancelled_total',
  help: 'Count of order cancellations by side',
  labelNames: ['client_id', 'side'] as const,
});

export const fillCounter = new Counter({
  name: 'fills_total',
  help: 'Count of fills by side',
  labelNames: ['client_id', 'side'] as const,
});

export const orderLatency = new Histogram({
  name: 'order_latency_ms',
  help: 'Latency from placement to completion (ms)',
  labelNames: ['client_id', 'side'] as const,
  buckets: [1000, 5000, 15000, 60000, 120000, 300000],
});

export const apiErrorCounter = new Counter({
  name: 'api_errors_total',
  help: 'API error counter',
  labelNames: ['client_id', 'type'] as const,
});

export const pnlGauge = new Gauge({
  name: 'pnl_realized_usd',
  help: 'Realized P&L in USD',
  labelNames: ['client_id'] as const,
});

export const intelligenceCompositeGauge = new Gauge({
  name: 'intelligence_composite_score',
  help: 'Composite score emitted by the market intelligence engine',
  labelNames: ['client_id', 'pair'] as const,
});

export const intelligenceRiskBiasGauge = new Gauge({
  name: 'intelligence_risk_bias',
  help: 'Risk stance suggested by the market intelligence engine (-1 reduce, 0 neutral, 1 increase)',
  labelNames: ['client_id', 'pair'] as const,
});

export const intelligenceVolatilityGauge = new Gauge({
  name: 'intelligence_garch_volatility',
  help: 'GARCH-style volatility estimate from the intelligence engine',
  labelNames: ['client_id', 'pair'] as const,
});

export const intelligencePerTradeGauge = new Gauge({
  name: 'intelligence_per_trade_usd',
  help: 'Per-trade USD allocation recommended by the intelligence engine',
  labelNames: ['client_id', 'pair'] as const,
});

export const intelligenceTakeProfitGauge = new Gauge({
  name: 'intelligence_take_profit_pct',
  help: 'Take profit percentage recommended by the intelligence engine',
  labelNames: ['client_id', 'pair'] as const,
});

export const riskVaRGauge = new Gauge({
  name: 'risk_value_at_risk_usd',
  help: 'Value at Risk (VaR) computed by risk engine',
  labelNames: ['client_id', 'pair'] as const,
});

export const riskStressLossGauge = new Gauge({
  name: 'risk_stress_loss_usd',
  help: 'Maximum stress scenario loss computed by risk engine',
  labelNames: ['client_id', 'pair'] as const,
});

export const riskKellyGauge = new Gauge({
  name: 'risk_kelly_fraction',
  help: 'Kelly criterion fraction used for position sizing',
  labelNames: ['client_id', 'pair'] as const,
});

export const inventoryGauge = new Gauge({
  name: 'inventory_base',
  help: 'Current base inventory levels',
  labelNames: ['client_id', 'asset'] as const,
});

export const clientQueueDepthGauge = new Gauge({
  name: 'client_queue_depth',
  help: 'Queued tasks per client (BullMQ waiting + delayed count)',
  labelNames: ['client_id'] as const,
});

export const clientWorkerStatusGauge = new Gauge({
  name: 'client_worker_status',
  help: 'Worker status per client (1=running,0=paused,-1=error,0.5=starting,-0.5=stopped)',
  labelNames: ['client_id', 'worker_id'] as const,
});

export const clientWorkerFailureCounter = new Counter({
  name: 'client_worker_failures_total',
  help: 'Total job failures per client worker',
  labelNames: ['client_id', 'worker_id'] as const,
});

export function startMetricsServer(port = Number(process.env.METRICS_PORT || 9100)) {
  if (metricsRegistered.started) return;
  metricsRegistered.started = true;
  const server = http.createServer(async (_req, res) => {
    if (_req.url === '/metrics') {
      try {
        const metrics = await register.metrics();
        res.writeHead(200, { 'Content-Type': register.contentType });
        res.end(metrics);
      } catch (err) {
        res.writeHead(500);
        res.end(String(err));
      }
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Metrics server listening on :${port}/metrics`);
  });
}

export function resetMetrics() {
  orderReplacementCounter.reset();
  orderCancelCounter.reset();
  fillCounter.reset();
  orderLatency.reset();
  apiErrorCounter.reset();
  pnlGauge.reset();
  intelligenceCompositeGauge.reset();
  intelligenceRiskBiasGauge.reset();
  intelligenceVolatilityGauge.reset();
  intelligencePerTradeGauge.reset();
  intelligenceTakeProfitGauge.reset();
  riskVaRGauge.reset();
  riskStressLossGauge.reset();
  riskKellyGauge.reset();
  inventoryGauge.reset();
  clientQueueDepthGauge.reset();
  clientWorkerStatusGauge.reset();
  clientWorkerFailureCounter.reset();
}
