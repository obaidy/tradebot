import { setInterval as safeSetInterval } from 'timers';
import { getPool, closePool } from '../db/pool';
import { runMigrations } from '../db/migrations';
import { GlobalKillSwitchSentinel } from '../guard/globalSentinel';
import { CONFIG } from '../config';
import { logger, setLogContext } from '../utils/logger';

const INTERVAL_MS = Number(process.env.KILL_SWITCH_SENTINEL_INTERVAL_MS ?? 30_000);

export async function startKillSwitchSentinel() {
  const pool = getPool();
  await runMigrations(pool);
  const clientId = CONFIG.RUN.CLIENT_ID;

  setLogContext({ worker: 'kill-switch-sentinel', clientId });

  const sentinel = new GlobalKillSwitchSentinel({
    clientId,
    pool,
  });

  const evaluate = async () => {
    await sentinel.evaluate();
  };

  await evaluate();

  const timer = safeSetInterval(() => {
    evaluate().catch((error) => {
      logger.error('kill_switch_sentinel_loop_failed', {
        event: 'kill_switch_sentinel_loop_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, INTERVAL_MS);

  const shutdown = async () => {
    timer.unref();
    await closePool();
  };

  return { shutdown };
}

if (require.main === module) {
  startKillSwitchSentinel()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log('[kill-switch-sentinel] started.');
    })
    .catch((error) => {
      logger.error('kill_switch_sentinel_start_failed', {
        event: 'kill_switch_sentinel_start_failed',
        error: error instanceof Error ? error.message : String(error),
      });
      // eslint-disable-next-line no-console
      console.error(error);
      process.exit(1);
    });
}
