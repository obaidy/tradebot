import { Queue, QueueScheduler } from 'bullmq';
import { URL } from 'url';
import type { StrategyId, StrategyRunMode } from '../strategies/types';

export type ClientTaskPayload = {
  type: 'run_strategy' | 'run_grid' | 'pause' | 'resume' | 'shutdown';
  clientId: string;
  data?: {
    strategyId?: StrategyId;
    pair?: string;
    runMode?: StrategyRunMode;
    actor?: string;
    config?: Record<string, unknown>;
  };
};

function getConnection() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;
  try {
    const parsed = new URL(redisUrl);
    const connection: Record<string, unknown> = {
      host: parsed.hostname,
      port: Number(parsed.port || '6379'),
      password: parsed.password || undefined,
    };
    if (parsed.protocol === 'rediss:' || parsed.searchParams.get('ssl') === 'true') {
      connection.tls = {};
    }
    // eslint-disable-next-line no-console
    console.log('[client-task-queue] connecting to Redis', {
      host: connection.host,
      port: connection.port,
      tls: Boolean(connection.tls),
    });
    return connection;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[client-task-queue] Invalid REDIS_URL; queue disabled', err);
    return null;
  }
}

const connection = getConnection();
const queueCache = new Map<string, Queue<ClientTaskPayload>>();

function buildQueue(clientId: string) {
  if (!connection) return null;
  const name = `client:${clientId}:tasks`;
  if (queueCache.has(name)) {
    return queueCache.get(name)!;
  }
  const queue = new Queue<ClientTaskPayload>(name, {
    connection,
    defaultJobOptions: { removeOnComplete: 100, removeOnFail: 200 },
  });
  // eslint-disable-next-line no-new
  new QueueScheduler(name, { connection })
    .waitUntilReady()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log('[client-task-queue] scheduler ready', { clientId, queue: name });
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[client-task-queue] scheduler error', { clientId, err });
    });
  queueCache.set(name, queue);
  return queue;
}

export const isClientTaskQueueEnabled = connection !== null;

export async function enqueueClientTask(payload: ClientTaskPayload) {
  if (!connection) {
    throw new Error('client_task_queue_disabled');
  }
  const queue = buildQueue(payload.clientId);
  if (!queue) {
    throw new Error('client_task_queue_unavailable');
  }
  return queue.add(payload.type, payload, { jobId: `${payload.type}-${Date.now()}` });
}

export function getClientQueueName(clientId: string) {
  return `client:${clientId}:tasks`;
}

export { connection as clientTaskConnection };
