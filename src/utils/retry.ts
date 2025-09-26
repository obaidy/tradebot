export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  backoffFactor?: number;
  maxDelayMs?: number;
  onRetry?: (error: unknown, attempt: number) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function retry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  let delay = Math.max(0, options.delayMs ?? 250);
  const backoff = options.backoffFactor ?? 2;
  const maxDelay = options.maxDelayMs ?? 5_000;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts) {
        throw error;
      }
      options.onRetry?.(error, attempt);
      if (delay > 0) {
        await sleep(delay);
        delay = Math.min(maxDelay, Math.ceil(delay * backoff));
      }
    }
  }
}
