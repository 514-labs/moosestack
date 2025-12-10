import http from "http";
import { createClient } from "@clickhouse/client";
import {
  KafkaConsumer,
  KafkaJS,
  type Message as NativeKafkaMessage,
  type ConsumerGlobalConfig,
  type ConsumerTopicConfig,
  type TopicPartition,
  type TopicPartitionOffset,
  type LibrdKafkaError,
  CODES,
} from "@confluentinc/kafka-javascript";
import { SASLOptions } from "@confluentinc/kafka-javascript/types/kafkajs";
const { Kafka } = KafkaJS;
type Kafka = KafkaJS.Kafka;
type Consumer = KafkaJS.Consumer;
export type Producer = KafkaJS.Producer;

// Re-export native consumer types for use in other modules
export {
  KafkaConsumer,
  type NativeKafkaMessage,
  type ConsumerGlobalConfig,
  type TopicPartition,
  type TopicPartitionOffset,
  type LibrdKafkaError,
  CODES,
};

/**
 * Utility function for compiler-related logging that can be disabled via environment variable.
 * Set MOOSE_DISABLE_COMPILER_LOGS=true to suppress these logs (useful for testing environments).
 */

/**
 * Returns true if the value is a common truthy string: "1", "true", "yes", "on" (case-insensitive).
 */
function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      return false;
  }
}

export const compilerLog = (message: string) => {
  if (!isTruthy(process.env.MOOSE_DISABLE_COMPILER_LOGS)) {
    console.log(message);
  }
};

export const antiCachePath = (path: string) =>
  `${path}?num=${Math.random().toString()}&time=${Date.now()}`;

export const getFileName = (filePath: string) => {
  const regex = /\/([^\/]+)\.ts/;
  const matches = filePath.match(regex);
  if (matches && matches.length > 1) {
    return matches[1];
  }
  return "";
};

interface ClientConfig {
  username: string;
  password: string;
  database: string;
  useSSL: string;
  host: string;
  port: string;
}

export const getClickhouseClient = ({
  username,
  password,
  database,
  useSSL,
  host,
  port,
}: ClientConfig) => {
  const protocol =
    useSSL === "1" || useSSL.toLowerCase() === "true" ? "https" : "http";
  console.log(`Connecting to Clickhouse at ${protocol}://${host}:${port}`);
  return createClient({
    url: `${protocol}://${host}:${port}`,
    username: username,
    password: password,
    database: database,
    application: "moose",
    // Note: wait_end_of_query is configured per operation type, not globally
    // to preserve SELECT query performance while ensuring INSERT/DDL reliability
  });
};

export type CliLogData = {
  message_type?: "Info" | "Success" | "Error" | "Highlight";
  action: string;
  message: string;
};

export const cliLog: (log: CliLogData) => void = (log) => {
  const req = http.request({
    port: parseInt(process.env.MOOSE_MANAGEMENT_PORT ?? "5001"),
    method: "POST",
    path: "/logs",
  });

  req.on("error", (err: Error) => {
    console.log(`Error ${err.name} sending CLI log.`, err.message);
  });

  req.write(JSON.stringify({ message_type: "Info", ...log }));
  req.end();
};

/**
 * Method to change .ts, .cts, and .mts to .js, .cjs, and .mjs
 * This is needed because 'import' does not support .ts, .cts, and .mts
 */
export function mapTstoJs(filePath: string): string {
  return filePath
    .replace(/\.ts$/, ".js")
    .replace(/\.cts$/, ".cjs")
    .replace(/\.mts$/, ".mjs");
}

export const MAX_RETRIES = 150;
export const MAX_RETRY_TIME_MS = 1000;
export const RETRY_INITIAL_TIME_MS = 100;

export const MAX_RETRIES_PRODUCER = 150;
export const RETRY_FACTOR_PRODUCER = 0.2;
// Means all replicas need to acknowledge the message
export const ACKs = -1;

/**
 * Creates the base producer configuration for Kafka.
 * Used by both the SDK stream publishing and streaming function workers.
 *
 * @param maxMessageBytes - Optional max message size in bytes (synced with topic config)
 * @returns Producer configuration object for the Confluent Kafka client
 */
export function createProducerConfig(maxMessageBytes?: number) {
  return {
    kafkaJS: {
      idempotent: false, // Not needed for at-least-once delivery
      acks: ACKs,
      retry: {
        retries: MAX_RETRIES_PRODUCER,
        maxRetryTime: MAX_RETRY_TIME_MS,
      },
    },
    "linger.ms": 0, // This is to make sure at least once delivery with immediate feedback on the send
    ...(maxMessageBytes && { "message.max.bytes": maxMessageBytes }),
  };
}

/**
 * Parses a comma-separated broker string into an array of valid broker addresses.
 * Handles whitespace trimming and filters out empty elements.
 *
 * @param brokerString - Comma-separated broker addresses (e.g., "broker1:9092, broker2:9092, , broker3:9092")
 * @returns Array of trimmed, non-empty broker addresses
 */
const parseBrokerString = (brokerString: string): string[] =>
  brokerString
    .split(",")
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

export type KafkaClientConfig = {
  clientId: string;
  broker: string;
  securityProtocol?: string; // e.g. "SASL_SSL" or "PLAINTEXT"
  saslUsername?: string;
  saslPassword?: string;
  saslMechanism?: string; // e.g. "scram-sha-256", "plain"
};

/**
 * Dynamically creates and connects a KafkaJS producer using the provided configuration.
 * Returns a connected producer instance.
 *
 * @param cfg - Kafka client configuration
 * @param logger - Logger instance
 * @param maxMessageBytes - Optional max message size in bytes (synced with topic config)
 */
export async function getKafkaProducer(
  cfg: KafkaClientConfig,
  logger: Logger,
  maxMessageBytes?: number,
): Promise<Producer> {
  const kafka = await getKafkaClient(cfg, logger);

  const producer = kafka.producer(createProducerConfig(maxMessageBytes));
  await producer.connect();
  return producer;
}

/**
 * Interface for logging functionality
 */
export interface Logger {
  logPrefix: string;
  log: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
}

export const logError = (logger: Logger, e: Error): void => {
  logger.error(e.message);
  const stack = e.stack;
  if (stack) {
    logger.error(stack);
  }
};

/**
 * Builds SASL configuration for Kafka client authentication
 */
const buildSaslConfig = (
  logger: Logger,
  args: KafkaClientConfig,
): SASLOptions | undefined => {
  const mechanism = args.saslMechanism ? args.saslMechanism.toLowerCase() : "";
  switch (mechanism) {
    case "plain":
    case "scram-sha-256":
    case "scram-sha-512":
      return {
        mechanism: mechanism,
        username: args.saslUsername || "",
        password: args.saslPassword || "",
      };
    default:
      logger.warn(`Unsupported SASL mechanism: ${args.saslMechanism}`);
      return undefined;
  }
};

/**
 * Dynamically creates a KafkaJS client configured with provided settings.
 * Use this to construct producers/consumers with custom options.
 */
export const getKafkaClient = async (
  cfg: KafkaClientConfig,
  logger: Logger,
): Promise<Kafka> => {
  const brokers = parseBrokerString(cfg.broker || "");
  if (brokers.length === 0) {
    throw new Error(`No valid broker addresses found in: "${cfg.broker}"`);
  }

  logger.log(`Creating Kafka client with brokers: ${brokers.join(", ")}`);
  logger.log(`Security protocol: ${cfg.securityProtocol || "plaintext"}`);
  logger.log(`Client ID: ${cfg.clientId}`);

  const saslConfig = buildSaslConfig(logger, cfg);

  return new Kafka({
    kafkaJS: {
      clientId: cfg.clientId,
      brokers,
      ssl: cfg.securityProtocol === "SASL_SSL",
      ...(saslConfig && { sasl: saslConfig }),
      retry: {
        initialRetryTime: RETRY_INITIAL_TIME_MS,
        maxRetryTime: MAX_RETRY_TIME_MS,
        retries: MAX_RETRIES,
      },
    },
  });
};

/**
 * Configuration for native KafkaConsumer
 */
export interface NativeConsumerConfig extends KafkaClientConfig {
  groupId: string;
  sessionTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  maxPollIntervalMs?: number;
  autoCommit?: boolean;
  autoCommitIntervalMs?: number;
  autoOffsetReset?: "smallest" | "earliest" | "largest" | "latest" | "error";
  maxBatchSize?: number;
}

/**
 * Builds the native SASL configuration for librdkafka.
 * Native consumer uses different config keys than KafkaJS wrapper.
 */
const buildNativeSaslConfig = (
  logger: Logger,
  cfg: KafkaClientConfig,
): Partial<ConsumerGlobalConfig> => {
  if (!cfg.saslMechanism || !cfg.saslUsername || !cfg.saslPassword) {
    return {};
  }

  const mechanism = cfg.saslMechanism.toUpperCase();
  const validMechanisms = ["PLAIN", "SCRAM-SHA-256", "SCRAM-SHA-512"];

  if (!validMechanisms.includes(mechanism)) {
    logger.warn(`Unsupported SASL mechanism: ${cfg.saslMechanism}`);
    return {};
  }

  return {
    "sasl.mechanisms": mechanism,
    "sasl.username": cfg.saslUsername,
    "sasl.password": cfg.saslPassword,
  };
};

/**
 * Creates a native KafkaConsumer instance (using librdkafka directly).
 * This provides lower-level control and potentially better performance than the KafkaJS wrapper.
 *
 * @param cfg - Consumer configuration
 * @param logger - Logger instance
 * @param rebalanceCb - Optional callback for rebalance events
 * @returns Configured but not yet connected KafkaConsumer
 */
export const createNativeKafkaConsumer = (
  cfg: NativeConsumerConfig,
  logger: Logger,
  rebalanceCb?: (err: LibrdKafkaError, assignments: TopicPartition[]) => void,
): KafkaConsumer => {
  const brokers = parseBrokerString(cfg.broker || "");
  if (brokers.length === 0) {
    throw new Error(`No valid broker addresses found in: "${cfg.broker}"`);
  }

  logger.log(
    `Creating native KafkaConsumer with brokers: ${brokers.join(", ")}`,
  );
  logger.log(`Security protocol: ${cfg.securityProtocol || "plaintext"}`);
  logger.log(`Client ID: ${cfg.clientId}`);
  logger.log(`Group ID: ${cfg.groupId}`);

  const saslConfig = buildNativeSaslConfig(logger, cfg);

  const consumerConfig: ConsumerGlobalConfig = {
    // Connection
    "bootstrap.servers": brokers.join(","),
    "client.id": cfg.clientId,

    // Group management
    "group.id": cfg.groupId,
    "session.timeout.ms": cfg.sessionTimeoutMs ?? 30000,
    "heartbeat.interval.ms": cfg.heartbeatIntervalMs ?? 3000,
    "max.poll.interval.ms": cfg.maxPollIntervalMs ?? 300000,

    // Offset management
    "enable.auto.commit": cfg.autoCommit ?? true,
    "auto.commit.interval.ms": cfg.autoCommitIntervalMs ?? 5000,

    // Security
    ...(cfg.securityProtocol === "SASL_SSL" && {
      "security.protocol": "sasl_ssl",
    }),
    ...saslConfig,

    // Rebalance callback
    ...(rebalanceCb && { rebalance_cb: rebalanceCb }),
  };

  // Topic-level config (auto.offset.reset belongs here)
  const topicConfig: ConsumerTopicConfig = {
    "auto.offset.reset": cfg.autoOffsetReset ?? "earliest",
  };

  return new KafkaConsumer(consumerConfig, topicConfig);
};
