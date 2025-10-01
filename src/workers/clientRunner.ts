import { Queue, Worker } from 'bullmq';
import { randomUUID } from 'crypto';
import ms from 'ms';
import { clientTaskConnection, getClientQueueName } from '../jobs/clientTaskQueue';
import { ClientTaskPayload } from '../jobs/clientTaskQueue';
import { getPool } from '../db/pool';
import { runMigrations } from '../db/migrations';
import { ClientsRepository, ClientStrategySecretsRepository } from '../db/clientsRepo';
import { ClientWorkersRepository, WorkerStatus } from '../db/clientWorkersRepo';
import { logger, setLogContext } from '../utils/logger';
import { getPlanById } from '../config/plans';
import { runStrategy, getStrategyDefinition, ensureStrategySupportsRunMode, checkStrategyRequirements } from '../strategies';
import type { StrategyId, StrategyRunMode } from '../strategies';
import type { PlanId } from '../config/planTypes';
import {
  clientQueueDepthGauge,
  clientWorkerFailureCounter,
  clientWorkerStatusGauge,
} from '../telemetry/metrics';
import { decryptSecret, initSecretManager } from '../secrets/secretManager';
import { ClientConfigService } from '../services/clientConfig';
import { buildPortfolioExecutionPlan } from '../services/portfolio/portfolioManager';

const HEARTBEAT_INTERVAL_MS = ms('15s');

const STATUS_VALUE_MAP: Record<WorkerStatus, number> = {
  starting: 0.5,
  running: 1,
  paused: 0,
  stopped: -0.5,
  error: -1,
};

type LastErrorMeta = {
  message: string;
  jobId?: string;
  failedAt: string;
  stack?: string;
};

async function main() {
  const clientId = process.env.CLIENT_ID || process.argv[2];
  if (!clientId) {
    throw new Error('CLIENT_ID is required (env var or argv[2])');
  }
  if (!clientTaskConnection) {
    throw new Error('REDIS_URL not configured; cannot start client runner');
  }

  const workerId = process.env.WORKER_ID || `${clientId}-${randomUUID()}`;

  const pool = getPool();
  await runMigrations(pool);
  const clientsRepo = new ClientsRepository(pool);
  const strategySecretsRepo = new ClientStrategySecretsRepository(pool);
  const workersRepo = new ClientWorkersRepository(pool);
  const configService = new ClientConfigService(pool, { allowedClientId: clientId });

  await workersRepo.upsert({
    workerId,
    clientId,
    status: 'starting',
    metadata: { pid: process.pid, queueDepth: 0 },
  });

  const queueName = getClientQueueName(clientId);
  setLogContext({ clientId, workerId });

  const queue = new Queue<ClientTaskPayload>(queueName, { connection: clientTaskConnection });
  clientQueueDepthGauge.labels(clientId).set(0);

  let workerStatus: WorkerStatus = 'starting';
  let lastErrorMeta: LastErrorMeta | null = null;

  const setStatus = (status: WorkerStatus) => {
    workerStatus = status;
    clientWorkerStatusGauge.labels(clientId, workerId).set(STATUS_VALUE_MAP[status]);
  };

  setStatus('starting');

  let shuttingDown = false;

  const worker = new Worker<ClientTaskPayload>(
    queueName,
    async (job) => {
      if (shuttingDown) {
        logger.warn('job_skipped_shutting_down', { event: 'job_skipped_shutting_down', clientId, workerId });
        return;
      }
      const client = await clientsRepo.findById(clientId);
      if (!client) {
        throw new Error(`client ${clientId} not found`);
      }
      const trialEndsAt: Date | null = (client as any).trialEndsAt ?? null;
      const billingStatus: string = (client as any).billingStatus ?? 'trialing';
      const billingAutoPaused: boolean = Boolean((client as any).billingAutoPaused);
      const trialExpired = trialEndsAt ? trialEndsAt.getTime() <= Date.now() : false;
      const billingActive =
        billingStatus === 'active' ||
        billingStatus === 'past_due' ||
        (billingStatus === 'trialing' && !trialExpired);
      if (!billingActive) {
        logger.warn('billing_inactive_run_blocked', {
          event: 'billing_inactive_run_blocked',
          clientId,
          workerId,
          billingStatus,
          trialExpired,
        });
        await clientsRepo.setBillingPause(clientId, { autoPaused: true, isPaused: true });
        setStatus('paused');
        return;
      }
      if (billingActive && billingAutoPaused && client.isPaused) {
        await clientsRepo.setBillingPause(clientId, { autoPaused: false, isPaused: false });
        logger.info('billing_auto_resume', {
          event: 'billing_auto_resume',
          clientId,
          workerId,
        });
      }
      if (client.killRequested) {
        logger.warn('client_kill_requested', {
          event: 'client_kill_requested',
          clientId,
          workerId,
        });
        shuttingDown = true;
        setStatus('stopped');
        return;
      }
      if (client.isPaused && job.name !== 'resume') {
        logger.info('client_paused', { event: 'client_paused', clientId, workerId, jobId: job.id });
        return;
      }

      const planId = ((client as any).plan ?? 'starter') as PlanId;

      switch (job.name) {
        case 'run_strategy':
        case 'run_grid': {
          const payload = job.data?.data ?? {};
          const requestedStrategy = (job.name === 'run_grid'
            ? 'grid'
            : (payload.strategyId as StrategyId) ?? 'grid') as StrategyId;
          const strategy = getStrategyDefinition(requestedStrategy);
          if (!strategy) {
            logger.warn('unknown_strategy_job', {
              event: 'unknown_strategy_job',
              clientId,
              workerId,
              strategyId: requestedStrategy,
              jobId: job.id,
            });
            break;
          }
          if (!strategy.allowedPlans.includes(planId)) {
            logger.warn('strategy_not_allowed_for_plan', {
              event: 'strategy_not_allowed_for_plan',
              clientId,
              workerId,
              strategyId: requestedStrategy,
              planId,
              jobId: job.id,
            });
            break;
          }
          const requestedRunMode = (payload.runMode as StrategyRunMode) ?? (strategy.supportsPaper ? 'paper' : 'live');
          let portfolioEntry:
            | {
                finalRunMode: StrategyRunMode;
                normalizedWeightPct: number;
                enabled: boolean;
                allocationUsd: number;
                reason?: string;
              }
            | null = null;
          try {
            const clientConfig = await configService.getClientConfig(clientId);
            const portfolioPlan = buildPortfolioExecutionPlan(clientConfig);
            const found = portfolioPlan.entries.find((entry) => entry.strategyId === requestedStrategy);
            if (found) {
              portfolioEntry = {
                finalRunMode: found.finalRunMode,
                normalizedWeightPct: found.normalizedWeightPct,
                enabled: found.enabled,
                reason: found.reason,
                allocationUsd: found.allocationUsd,
              };
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn('portfolio_plan_unavailable', {
              event: 'portfolio_plan_unavailable',
              clientId,
              workerId,
              strategyId: requestedStrategy,
              jobId: job.id,
              error: message,
            });
          }

          if (portfolioEntry && (!portfolioEntry.enabled || portfolioEntry.normalizedWeightPct <= 0)) {
            logger.info('portfolio_entry_skipped', {
              event: 'portfolio_entry_skipped',
              clientId,
              workerId,
              strategyId: requestedStrategy,
              jobId: job.id,
              reason: portfolioEntry.reason ?? 'disabled_or_zero_weight',
            });
            break;
          }

          const runMode = portfolioEntry ? portfolioEntry.finalRunMode : requestedRunMode;
          if (!ensureStrategySupportsRunMode(strategy, runMode)) {
            break;
          }
          let strategyConfig = (payload.config as Record<string, unknown> | undefined) ?? undefined;
          let updateStrategySecretMetadata:
            | ((patch: Record<string, unknown>) => Promise<void>)
            | undefined;
          if (strategy.id === 'mev') {
            const secretRow = await strategySecretsRepo.get(clientId, strategy.id);
            if (!secretRow) {
              logger.warn('strategy_secret_missing', {
                event: 'strategy_secret_missing',
                clientId,
                workerId,
                strategyId: requestedStrategy,
                jobId: job.id,
              });
              break;
            }
            await initSecretManager();
            const privateKey = decryptSecret(secretRow.secretEnc);
            strategyConfig = { ...(strategyConfig ?? {}), privateKey };
            let secretMetadata = { ...(secretRow.metadata ?? {}) } as Record<string, unknown>;
            updateStrategySecretMetadata = async (patch: Record<string, unknown>) => {
              secretMetadata = { ...secretMetadata, ...patch };
              await strategySecretsRepo.updateMetadata(clientId, strategy.id, secretMetadata);
            };
          }
          if (!checkStrategyRequirements(strategy, { config: strategyConfig })) {
            break;
          }

          if (portfolioEntry) {
            strategyConfig = {
              ...(strategyConfig ?? {}),
              portfolioAllocationUsd: portfolioEntry.allocationUsd,
              portfolioWeightPct: portfolioEntry.normalizedWeightPct,
            };
          }
          const pair = (payload.pair as string) || strategy.defaultPair;
          const actor = payload.actor as string | undefined;

          logger.info('client_strategy_run_start', {
            event: 'client_strategy_run_start',
            clientId,
            workerId,
            strategyId: requestedStrategy,
            planId,
            pair,
            runMode,
            jobId: job.id,
            portfolioWeight: portfolioEntry ? portfolioEntry.normalizedWeightPct : null,
            portfolioAllocationUsd: portfolioEntry ? portfolioEntry.allocationUsd : null,
          });
          await runStrategy(requestedStrategy, {
            clientId,
            planId,
            pair,
            runMode,
            actor,
            config: strategyConfig,
            services: updateStrategySecretMetadata
              ? { updateStrategySecretMetadata }
              : undefined,
          });
          logger.info('client_strategy_run_complete', {
            event: 'client_strategy_run_complete',
            clientId,
            workerId,
            strategyId: requestedStrategy,
            planId,
            pair,
            jobId: job.id,
            portfolioWeight: portfolioEntry ? portfolioEntry.normalizedWeightPct : null,
            portfolioAllocationUsd: portfolioEntry ? portfolioEntry.allocationUsd : null,
          });
          break;
        }
        case 'pause': {
          await clientsRepo.setPauseState(clientId, true);
          logger.info('client_paused_command', { event: 'client_paused_command', clientId, workerId });
          break;
        }
        case 'resume': {
          await clientsRepo.setPauseState(clientId, false);
          logger.info('client_resumed_command', { event: 'client_resumed_command', clientId, workerId });
          break;
        }
        case 'shutdown': {
          logger.warn('shutdown_command_received', { event: 'shutdown_command_received', clientId, workerId });
          shuttingDown = true;
          setStatus('stopped');
          break;
        }
        default:
          logger.warn('unknown_job_type', { event: 'unknown_job_type', clientId, workerId, jobName: job.name });
      }
    },
    {
      connection: clientTaskConnection,
      concurrency: 1,
    }
  );

  worker.on('active', () => {
    if (!shuttingDown && workerStatus !== 'error') {
      setStatus('running');
    }
  });

  worker.on('completed', () => {
    lastErrorMeta = null;
    if (!shuttingDown) {
      setStatus('running');
    }
  });

  worker.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    lastErrorMeta = {
      message,
      failedAt: new Date().toISOString(),
      stack: err instanceof Error ? err.stack : undefined,
    };
    setStatus('error');
    logger.error('client_worker_error', {
      event: 'client_worker_error',
      clientId,
      workerId,
      error: message,
    });
  });

  worker.on('failed', (job, err) => {
    const message = err instanceof Error ? err.message : String(err);
    lastErrorMeta = {
      message,
      jobId: job?.id,
      failedAt: new Date().toISOString(),
      stack: err instanceof Error ? err.stack : undefined,
    };
    clientWorkerFailureCounter.labels(clientId, workerId).inc();
    setStatus('error');
    logger.error('client_job_failed', {
      event: 'client_job_failed',
      clientId,
      workerId,
      jobId: job?.id,
      error: message,
    });
  });

  setStatus('running');

  const heartbeat = setInterval(async () => {
    try {
      let waiting = 0;
      let delayed = 0;
      try {
        [waiting, delayed] = await Promise.all([
          queue.getWaitingCount(),
          queue.getDelayedCount(),
        ]);
      } catch (err) {
        logger.warn('client_queue_metrics_failed', {
          event: 'client_queue_metrics_failed',
          clientId,
          workerId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const queueDepth = waiting + delayed;
      clientQueueDepthGauge.labels(clientId).set(queueDepth);

      const client = await clientsRepo.findById(clientId);
      if (client?.killRequested) {
        shuttingDown = true;
      }

      let statusForHeartbeat: WorkerStatus = workerStatus;
      if (shuttingDown) {
        statusForHeartbeat = 'stopped';
        setStatus('stopped');
      } else if (workerStatus === 'error') {
        statusForHeartbeat = 'error';
      } else if (client?.isPaused) {
        statusForHeartbeat = 'paused';
      } else {
        statusForHeartbeat = 'running';
      }

      clientWorkerStatusGauge.labels(clientId, workerId).set(STATUS_VALUE_MAP[statusForHeartbeat]);

      const metadata: Record<string, unknown> = {
        pid: process.pid,
        queueDepth,
      };
      if (client) {
        const clientTrialEnds = (client as any).trialEndsAt as Date | null;
        const clientBillingStatus = (client as any).billingStatus ?? 'trialing';
        metadata.billingStatus = clientBillingStatus;
        metadata.trialEndsAt = clientTrialEnds ? clientTrialEnds.toISOString() : null;
        metadata.trialExpired = clientTrialEnds ? clientTrialEnds.getTime() <= Date.now() : false;
        metadata.billingAutoPaused = Boolean((client as any).billingAutoPaused);
      }
      if (lastErrorMeta) {
        metadata.lastError = lastErrorMeta;
      }

      await workersRepo.heartbeat(workerId, statusForHeartbeat, metadata);

      if (shuttingDown) {
        clearInterval(heartbeat);
        try {
          await worker.close();
        } finally {
          await queue.close();
          clientQueueDepthGauge.labels(clientId).set(0);
          clientWorkerStatusGauge.labels(clientId, workerId).set(STATUS_VALUE_MAP.stopped);
        }
        const shutdownMeta: Record<string, unknown> = {
          pid: process.pid,
          reason: 'shutdown',
          queueDepth,
        };
        if (lastErrorMeta) {
          shutdownMeta.lastError = lastErrorMeta;
        }
        await workersRepo.heartbeat(workerId, 'stopped', shutdownMeta);
        process.exit(0);
      }
    } catch (err) {
      logger.error('client_worker_heartbeat_failed', {
        event: 'client_worker_heartbeat_failed',
        clientId,
        workerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, HEARTBEAT_INTERVAL_MS);

  process.on('SIGTERM', () => {
    shuttingDown = true;
    setStatus('stopped');
  });

  process.on('SIGINT', () => {
    shuttingDown = true;
    setStatus('stopped');
  });

  await workersRepo.heartbeat(workerId, 'running', { pid: process.pid });
  // eslint-disable-next-line no-console
  console.log(`[client-runner] Worker ${workerId} ready for client ${clientId}`);
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[client-runner] fatal error', err);
    process.exit(1);
  });
}
