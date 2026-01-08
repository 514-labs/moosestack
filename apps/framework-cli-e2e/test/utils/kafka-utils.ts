import { promisify } from "util";
import { withRetries } from "./retry-utils";
import { logger, ScopedLogger } from "./logger";

const kafkaLogger = logger.scope("utils:kafka");

export interface KafkaOptions {
  logger?: ScopedLogger;
}

const execAsync = promisify(require("child_process").exec);

const KAFKA_HOST = "localhost";
const KAFKA_PORT = 19092;

/**
 * Check if Kafka broker is ready to accept connections
 * Uses kafka-broker-api-versions.sh to verify Kafka is responsive
 */
export const isKafkaReady = async (
  options: KafkaOptions = {},
): Promise<boolean> => {
  const log = options.logger ?? kafkaLogger;

  try {
    // Try to establish a TCP connection to Kafka
    // We use a simple timeout-based nc (netcat) command to check if the port is open and responsive
    const command = `bash -c "echo > /dev/tcp/${KAFKA_HOST}/${KAFKA_PORT}" 2>/dev/null && echo "success" || echo "failed"`;

    const { stdout } = await execAsync(command, { timeout: 3000 });
    const ready = stdout.trim() === "success";
    if (ready) {
      log.debug("Kafka broker is ready", {
        host: KAFKA_HOST,
        port: KAFKA_PORT,
      });
    }
    return ready;
  } catch (error) {
    log.debug("Kafka connection check failed", {
      host: KAFKA_HOST,
      port: KAFKA_PORT,
    });
    return false;
  }
};

/**
 * Wait for Kafka broker to be ready
 * Retries connection attempts until Kafka is responsive
 *
 * @param timeout - Maximum time to wait in milliseconds (default: 60 seconds)
 */
export const waitForKafkaReady = async (
  timeout: number = 60_000,
  options: KafkaOptions = {},
): Promise<void> => {
  const log = options.logger ?? kafkaLogger;
  log.debug("Waiting for Kafka broker to be ready", {
    host: KAFKA_HOST,
    port: KAFKA_PORT,
    timeout,
  });

  const startTime = Date.now();
  const maxAttempts = Math.ceil(timeout / 1000); // Attempt every second

  await withRetries(
    async () => {
      const ready = await isKafkaReady({ logger: log });
      if (!ready) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        throw new Error(
          `Kafka not ready yet (${elapsed}s elapsed, will retry...)`,
        );
      }
      log.debug("✓ Kafka broker is ready");
    },
    {
      attempts: maxAttempts,
      delayMs: 1000,
      logger: log,
      operationName: "Kafka readiness check",
    },
  );
};
