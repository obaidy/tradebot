import { Worker } from 'bullmq';
import { paperRunQueue, isPaperRunQueueEnabled, PaperRunJob } from './paperRunQueue';
import { getPool } from '../db/pool';
import { runMigrations } from '../db/migrations';
import { runGridOnce } from '../strategies/gridBot';
import { ClientAuditLogRepository } from '../db/auditLogRepo';
import { logger, setLogContext } from '../utils/logger';

async function processJob(job: PaperRunJob) {
  const pool = getPool();
  await runMigrations(pool);
  const audit = new ClientAuditLogRepository(pool);
  const clientId = job.clientId;
  const actor = job.actor ?? 'paper-runner';

  setLogContext({ clientId, job: job.pair ?? 'default-pair' });

  await audit.addEntry({
    clientId,
    actor,
    action: 'paper_run_started',
    metadata: { pair: job.pair ?? 'BTC/USDT' },
  });

  try {
    const plan = await runGridOnce(job.pair ?? 'BTC/USDT', undefined, undefined, {
      clientId,
      runMode: 'paper',
    });

    await audit.addEntry({
      clientId,
      actor: 'paper-runner',
      action: 'paper_run_completed',
      metadata: plan
        ? {
            runId: plan.runId,
            generatedAt: plan.generatedAt,
            perTradeUsd: plan.perTradeUsd,
            gridSteps: plan.gridSteps,
            feePct: plan.feePct,
          }
        : null,
    });
  } catch (err) {
    await audit.addEntry({
      clientId,
      actor: 'paper-runner',
      action: 'paper_run_failed',
      metadata: {
        error: err instanceof Error ? err.message : String(err),
      },
    });
    logger.error('paper_run_failed', {
      event: 'paper_run_failed',
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

export function startPaperRunWorker() {
  if (!isPaperRunQueueEnabled || !paperRunQueue) {
    // eslint-disable-next-line no-console
    console.warn('[paper-run-worker] Queue disabled (no REDIS_URL). Worker not started.');
    return null;
  }
  // eslint-disable-next-line no-console
  console.log('[paper-run-worker] starting worker...');
  const worker = new Worker<PaperRunJob>('paper-run', async (job) => {
    await processJob(job.data);
  }, {
    connection: paperRunQueue.opts.connection,
  });

  worker.on('failed', (job, err) => {
    logger.error('paper_run_job_failed', {
      event: 'paper_run_job_failed',
      jobId: job?.id,
      error: err?.message,
    });
  });

  return worker;
}

if (require.main === module) {
  startPaperRunWorker();
}
