import { promisify } from "util";
import { withRetries } from "./retry-utils";

const execAsync = promisify(require("child_process").exec);

const KAFKA_HOST = "localhost";
const KAFKA_PORT = 19092;

/**
 * Check if Kafka broker is ready to accept connections
 * Uses kafka-broker-api-versions.sh to verify Kafka is responsive
 */
export const isKafkaReady = async (): Promise<boolean> => {
  try {
    // Try to establish a TCP connection to Kafka
    // We use a simple timeout-based nc (netcat) command to check if the port is open and responsive
    const command = `timeout 2 bash -c "echo > /dev/tcp/${KAFKA_HOST}/${KAFKA_PORT}" 2>/dev/null && echo "success" || echo "failed"`;

    const { stdout } = await execAsync(command, { timeout: 3000 });
    return stdout.trim() === "success";
  } catch (error) {
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
): Promise<void> => {
  console.log(
    `Waiting for Kafka broker at ${KAFKA_HOST}:${KAFKA_PORT} to be ready...`,
  );

  const startTime = Date.now();
  const maxAttempts = Math.ceil(timeout / 1000); // Attempt every second

  await withRetries(
    async () => {
      const ready = await isKafkaReady();
      if (!ready) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        throw new Error(
          `Kafka not ready yet (${elapsed}s elapsed, will retry...)`,
        );
      }
      console.log("✓ Kafka broker is ready");
    },
    {
      attempts: maxAttempts,
      delayMs: 1000,
    },
  );
};
