import http from 'http';
import { Pool } from 'pg';
import { CONFIG } from '../config';

let serverStarted = false;

function renderHtml(data: {
  run: any;
  orders: any[];
  guard: any;
  pnl: number;
  clientId: string;
}) {
  const runSection = data.run
    ? `<h2>Latest Run (${data.run.run_id})</h2>
       <p>Status: <strong>${data.run.status}</strong></p>
       <p>Owner/Client: ${data.run.owner} / ${data.run.client_id}</p>
       <pre>${JSON.stringify(data.run.params_json, null, 2)}</pre>`
    : '<h2>No runs yet</h2>';

  const ordersRows = data.orders
    .map(
      (o) =>
        `<tr>
          <td>${o.id}</td>
          <td>${o.side}</td>
          <td>${o.price}</td>
          <td>${o.amount}</td>
          <td>${o.filled_amount}</td>
          <td>${o.status}</td>
          <td>${o.correlation_id || ''}</td>
        </tr>`
    )
    .join('');

  const ordersTable = `<h3>Recent Orders</h3>
    <table border="1" cellspacing="0" cellpadding="4">
      <thead><tr><th>ID</th><th>Side</th><th>Price</th><th>Amount</th><th>Filled</th><th>Status</th><th>Correlation</th></tr></thead>
      <tbody>${ordersRows || '<tr><td colspan="7">None</td></tr>'}</tbody>
    </table>`;

  const guard = data.guard
    ? `<h3>Guard State</h3>
       <ul>
         <li>Global PnL: ${data.guard.global_pnl}</li>
         <li>Run PnL: ${data.guard.run_pnl}</li>
         <li>Inventory Base: ${data.guard.inventory_base}</li>
         <li>Inventory Cost: ${data.guard.inventory_cost}</li>
         <li>Last Ticker: ${new Date(Number(data.guard.last_ticker_ts || 0)).toISOString()}</li>
         <li>API Errors (last min): ${(data.guard.api_error_timestamps || []).length}</li>
       </ul>`
    : '';

  return `<!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>TradeBot Dashboard</title>
    <style>
      body { font-family: sans-serif; margin: 20px; }
      pre { background: #f4f4f4; padding: 10px; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      th { background: #eee; }
    </style>
  </head>
  <body>
    <h1>TradeBot Dashboard — Client ${data.clientId}</h1>
    ${runSection}
    ${ordersTable}
    ${guard}
    <p>Realized PnL (telemetry gauge): ${data.pnl}</p>
    <p><a href="/api/status">JSON API</a> | <a href="/metrics">Prometheus Metrics</a></p>
  </body>
  </html>`;
}

async function fetchDashboardData(pool: Pool, clientId: string) {
  const runRes = await pool.query(
    'SELECT * FROM bot_runs WHERE client_id = $1 ORDER BY started_at DESC LIMIT 1',
    [clientId]
  );
  const run = runRes.rows[0] ?? null;
  const guardRes = await pool.query('SELECT * FROM bot_guard_state WHERE client_id = $1', [clientId]);
  const guard = guardRes.rows[0] ?? null;
  const orders = run
    ? (
        await pool.query(
          `SELECT * FROM bot_orders WHERE run_id = $1 AND client_id = $2 ORDER BY created_at DESC LIMIT 50`,
          [run.run_id, clientId]
        )
      ).rows
    : [];

  return {
    run,
    orders,
    guard,
    pnl: guard ? Number(guard.global_pnl || 0) : 0,
    clientId,
  };
}

export function startDashboardServer(
  pool: Pool,
  port?: number,
  clientId = process.env.DASHBOARD_CLIENT_ID || CONFIG.RUN.CLIENT_ID || 'default'
) {
  if (serverStarted) return;
  serverStarted = true;
  const envPortRaw = process.env.DASHBOARD_PORT || process.env.PORT;
  const envPort = envPortRaw ? Number(envPortRaw) : NaN;
  const requestedPort = typeof port === 'number' ? port : envPort;
  const listenPort = Number.isFinite(requestedPort) && requestedPort! > 0 && requestedPort! < 65536 ? requestedPort! : 9102;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === '/' && req.method === 'GET') {
        const data = await fetchDashboardData(pool, clientId);
        const html = renderHtml(data);
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
        return;
      }
      if (req.url === '/api/status' && req.method === 'GET') {
        const data = await fetchDashboardData(pool, clientId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
        return;
      }
      if (req.url === '/metrics' && req.method === 'GET') {
        res.writeHead(302, { Location: 'http://localhost:' + (process.env.METRICS_PORT || 9100) + '/metrics' });
        res.end();
        return;
      }
      res.writeHead(404);
      res.end('Not found');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (err as Error).message }));
    }
  });

  server.listen(listenPort, () => {
    // eslint-disable-next-line no-console
    console.log(`Dashboard available at http://0.0.0.0:${listenPort}`);
  });
}
