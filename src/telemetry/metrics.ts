import http from 'http';
import { Counter, Gauge, Histogram, register } from 'prom-client';

const metricsRegistered: { started: boolean } = { started: false };

export const orderReplacementCounter = new Counter({
  name: 'orders_replaced_total',
  help: 'Count of order replacements by side',
  labelNames: ['side'] as const,
});

export const orderCancelCounter = new Counter({
  name: 'orders_cancelled_total',
  help: 'Count of order cancellations by side',
  labelNames: ['side'] as const,
});

export const fillCounter = new Counter({
  name: 'fills_total',
  help: 'Count of fills by side',
  labelNames: ['side'] as const,
});

export const orderLatency = new Histogram({
  name: 'order_latency_ms',
  help: 'Latency from placement to completion (ms)',
  labelNames: ['side'] as const,
  buckets: [1000, 5000, 15000, 60000, 120000, 300000],
});

export const apiErrorCounter = new Counter({
  name: 'api_errors_total',
  help: 'API error counter',
  labelNames: ['type'] as const,
});

export const pnlGauge = new Gauge({
  name: 'pnl_realized_usd',
  help: 'Realized P&L in USD',
});

export const inventoryGauge = new Gauge({
  name: 'inventory_base',
  help: 'Current base inventory levels',
  labelNames: ['asset'] as const,
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
  inventoryGauge.reset();
}
