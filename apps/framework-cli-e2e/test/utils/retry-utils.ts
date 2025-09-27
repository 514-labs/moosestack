import { RETRY_CONFIG } from "../constants";

const setTimeoutAsync = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  backoffFactor?: number;
}

/**
 * Retries an async operation with configurable backoff
 */
export const withRetries = async <T>(
  operation: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> => {
  const attempts = options?.attempts ?? RETRY_CONFIG.DEFAULT_ATTEMPTS;
  const backoffFactor =
    options?.backoffFactor ?? RETRY_CONFIG.DEFAULT_BACKOFF_FACTOR;
  let delayMs = options?.delayMs ?? RETRY_CONFIG.DEFAULT_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await setTimeoutAsync(delayMs);
      delayMs = Math.ceil(delayMs * backoffFactor);
    }
  }
  throw lastError as Error;
};
