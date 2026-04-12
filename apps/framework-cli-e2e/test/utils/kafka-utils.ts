import { promisify } from "util";
import { Kafka, logLevel } from "kafkajs";
import { withRetries } from "./retry-utils";
import { logger, ScopedLogger } from "./logger";

const kafkaLogger = logger.scope("utils:kafka");

export interface KafkaOptions {
  logger?: ScopedLogger;
}

const execAsync = promisify(require("child_process").exec);

// Use 127.0.0.1 (IPv4) explicitly because devkafka binds to 127.0.0.1
// and "localhost" may resolve to ::1 (IPv6) first on some CI runners.
const KAFKA_HOST = "127.0.0.1";
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
    // Try to establish a TCP connection to Kafka using bash's /dev/tcp
    // The connection check is wrapped with an outer timeout enforced by execAsync
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

/**
 * Wait for consumer groups to reach Stable state by polling devkafka's
 * ListGroups/DescribeGroups APIs via kafkajs.
 *
 * If no relevant consumer groups appear within 10 consecutive checks,
 * assumes streaming is not active and returns early.
 */
export const waitForConsumerGroupsStable = async (
  timeoutMs: number = 60_000,
  options: KafkaOptions = {},
): Promise<void> => {
  const log = options.logger ?? kafkaLogger;
  const brokerAddress = `${KAFKA_HOST}:${KAFKA_PORT}`;

  const kafka = new Kafka({
    clientId: "e2e-group-checker",
    brokers: [brokerAddress],
    logLevel: logLevel.NOTHING,
    retry: { retries: 2 },
  });

  const admin = kafka.admin();
  const startTime = Date.now();
  let noGroupsCount = 0;

  try {
    await admin.connect();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const { groups: listedGroups } = await admin.listGroups();

        const relevantGroups = listedGroups.filter(
          (g) =>
            g.groupId.includes("flow-") ||
            g.groupId.includes("clickhouse_sync"),
        );

        if (relevantGroups.length === 0) {
          noGroupsCount++;
          if (noGroupsCount >= 10) {
            log.debug(
              "No consumer groups found after 10s, assuming streaming is not active",
            );
            return;
          }
          log.debug(
            `No consumer groups yet (${noGroupsCount}/10 before giving up)`,
          );
        } else {
          noGroupsCount = 0;
          const groupIds = relevantGroups.map((g) => g.groupId);
          const described = await admin.describeGroups(groupIds);

          const allStable = described.groups.every((g) => g.state === "Stable");

          if (allStable) {
            log.debug(
              `All ${groupIds.length} consumer groups are Stable: ${groupIds.join(", ")}`,
            );
            // Brief settle after stabilization
            await new Promise((r) => setTimeout(r, 2000));
            return;
          }

          const states = described.groups.map((g) => `${g.groupId}=${g.state}`);
          log.debug(`Waiting for groups: ${states.join(", ")}`);
        }
      } catch (error) {
        log.debug("Error checking consumer groups, retrying", {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      await new Promise((r) => setTimeout(r, 1000));
    }

    throw new Error(
      `Consumer groups did not stabilize within ${Math.floor(timeoutMs / 1000)}s`,
    );
  } finally {
    try {
      await admin.disconnect();
    } catch {
      // Best effort disconnect
    }
  }
};
