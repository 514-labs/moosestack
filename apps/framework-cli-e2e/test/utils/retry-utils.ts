import { RETRY_CONFIG } from "../constants";
import { logger, ScopedLogger } from "./logger";

const retryLogger = logger.scope("utils:retry");

const setTimeoutAsync = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  backoffFactor?: number;
  logger?: ScopedLogger; // Optional logger for test context
  operationName?: string; // Optional name for better logging
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
  const log = options?.logger ?? retryLogger;
  const opName = options?.operationName ?? "operation";

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      if (attempt > 1) {
        log.debug(`Retry attempt ${attempt}/${attempts} for ${opName}`);
      }
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        log.warn(
          `${opName} failed after ${attempts} attempts`,
          error instanceof Error ? { message: error.message } : error,
        );
        break;
      }
      log.debug(
        `${opName} failed, retrying in ${delayMs}ms (attempt ${attempt}/${attempts})`,
      );
      await setTimeoutAsync(delayMs);
      delayMs = Math.ceil(delayMs * backoffFactor);
    }
  }
  throw lastError as Error;
};
