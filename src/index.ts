// src/index.ts (env-driven, updated defaults for chosen grid candidate)
import { runGridOnce } from './strategies/gridBot';
import { runGuardedGrid } from './strategies/gridBot_live_guard';
import { CONFIG } from './config';
import { startMetricsServer } from './telemetry/metrics';
import { startKillSwitchServer } from './guard/killSwitch';
import { circuitBreaker } from './guard/circuitBreaker';
import { setLogIngestionWebhook } from './utils/logger';
import { startDashboardServer } from './dashboard/server';
import { getPool } from './db/pool';
import { runMigrations } from './db/migrations';

function envNum(name: string, fallback: number) {
  const v = process.env[name];
  return v !== undefined ? Number(v) : fallback;
}

async function main() {
  console.log('Starting TradeBot (starter) - PAPER_MODE=', CONFIG.PAPER_MODE);

  const pool = getPool();
  await runMigrations(pool);

  startMetricsServer();
  startKillSwitchServer();
  startDashboardServer(pool);
  if (process.env.LOG_INGEST_WEBHOOK) {
    setLogIngestionWebhook(process.env.LOG_INGEST_WEBHOOK);
  }
  setInterval(() => circuitBreaker.checkStaleData(), 60 * 1000);

  const useGuard = (process.env.USE_GUARD ?? 'true').toLowerCase() === 'true';

  // DEFAULTS SET TO THE SELECTED PAPER CANDIDATE
  const params = {
    gridSteps: envNum('GRID_STEPS', 8),           // was 8
    k: envNum('K', 1),                           // changed from 0.5 -> 1 (chosen candidate)
    tp: envNum('TP', 0.05),                      // 5% TP
    perTrade: envNum('PER_TRADE', 0.01),         // 1% of bankroll per order
    smaPeriodHours: envNum('SMA_HOURS', 24),     // guard uses 24h SMA
    meanRevertPct: envNum('MEAN_REVERT_PCT', 0.01),
    minAtrPct: envNum('MIN_ATR_PCT', 0.006),

    // optional controls you can tune via env:
    maxConcurrentGrids: envNum('MAX_CONCURRENT', 1),
    stopLossPct: envNum('STOP_LOSS_PCT', 0.10)   // hard global stop (10%)
  };

  console.log('Using params:', params, 'USE_GUARD=', useGuard);

  try {
    const shouldAutoRun = (process.env.AUTO_RUN ?? 'false').toLowerCase() === 'true';
    if (!shouldAutoRun) {
      console.log('AUTO_RUN disabled — services started, skipping grid execution.');
      return;
    }

    if (useGuard) {
      // runGuardedGrid accepts these params in your codebase — preserves behavior
      await runGuardedGrid('BTC/USDT', params as any);
    } else {
      await runGridOnce('BTC/USDT');
    }
    console.log('Grid run finished.');
  } catch (err) {
    console.error('Fatal', err);
    process.exit(1);
  }
}

main();
