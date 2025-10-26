import { Queue, QueueScheduler } from 'bullmq';
import { URL } from 'url';

export type PaperRunJob = {
  clientId: string;
  pair?: string;
  actor?: string;
};

function buildConnection() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return null;
  }
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
    console.log('[paper-run-queue] connecting to Redis', {
      host: connection.host,
      port: connection.port,
      tls: Boolean(connection.tls),
    });
    return connection;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[paper-run-queue] Invalid REDIS_URL; queue disabled', err);
    return null;
  }
}

const connection = buildConnection();

export const paperRunQueue = connection
  ? new Queue<PaperRunJob>('paper-run', { connection, defaultJobOptions: { removeOnComplete: true, removeOnFail: 50 } })
  : null;

if (connection && paperRunQueue) {
  // eslint-disable-next-line no-new
  new QueueScheduler('paper-run', { connection })
    .waitUntilReady()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log('[paper-run-queue] scheduler ready');
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[paper-run-queue] scheduler error', err);
    });
}

export const isPaperRunQueueEnabled = paperRunQueue !== null;

export async function enqueuePaperRun(job: PaperRunJob) {
  if (!paperRunQueue) {
    throw new Error('paper_run_queue_disabled');
  }
  return paperRunQueue.add('paper-run', job);
}
