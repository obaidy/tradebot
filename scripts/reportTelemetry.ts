import { getPool, closePool } from '../src/db/pool';

function parseArgs(): { clientId: string; limit: number } {
  const [, , ...rest] = process.argv;
  let clientId = process.env.CLIENT_ID || '';
  let limit = 5;

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === '--client' || token === '-c') {
      clientId = rest[i + 1] ?? clientId;
      i += 1;
    } else if (token === '--limit' || token === '-n') {
      const next = Number(rest[i + 1]);
      if (Number.isFinite(next) && next > 0) {
        limit = next;
      }
      i += 1;
    } else if (!clientId) {
      clientId = token;
    }
  }

  if (!clientId) {
    throw new Error('client id is required (pass --client or set CLIENT_ID)');
  }

  return { clientId, limit };
}

async function main() {
  const { clientId, limit } = parseArgs();
  const pool = getPool();
  try {
    const runs = await pool.query(
      `SELECT run_id, status, params_json ->> 'runMode' AS run_mode, params_json -> 'summary' AS summary, started_at, ended_at
       FROM bot_runs
       WHERE client_id = $1
       ORDER BY started_at DESC
       LIMIT $2`,
      [clientId, limit]
    );

    const guard = await pool.query(
      `SELECT global_pnl, run_pnl, inventory_base, inventory_cost, last_ticker_ts, api_error_timestamps
       FROM bot_guard_state
       WHERE client_id = $1`,
      [clientId]
    );

    const inventory = await pool.query(
      `SELECT snapshot_time, base_asset, quote_asset, base_balance, quote_balance, exposure_usd
       FROM bot_inventory_snapshots
       WHERE client_id = $1
       ORDER BY snapshot_time DESC
       LIMIT $2`,
      [clientId, limit]
    );

    const telemetry = {
      clientId,
      runs: runs.rows,
      guard: guard.rows[0] ?? null,
      inventory: inventory.rows,
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(telemetry, null, 2));
  } finally {
    await closePool();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('[reportTelemetry] failed', error);
  process.exit(1);
});
