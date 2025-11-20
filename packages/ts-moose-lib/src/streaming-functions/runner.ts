import { Readable } from "node:stream";
import { KafkaJS } from "@confluentinc/kafka-javascript";
const { Kafka } = KafkaJS;

type Consumer = KafkaJS.Consumer;
type Producer = KafkaJS.Producer;

type KafkaMessage = {
  value: Buffer | string | null;
  key?: Buffer | string | null;
  partition?: number;
  offset?: string;
  timestamp?: string;
  headers?: Record<string, Buffer | string | undefined>;
};

type SASLOptions = {
  mechanism: "plain" | "scram-sha-256" | "scram-sha-512";
  username: string;
  password: string;
};
import { Buffer } from "node:buffer";
import * as process from "node:process";
import * as http from "node:http";
import {
  cliLog,
  getKafkaClient,
  RETRY_FACTOR_PRODUCER,
  MAX_RETRIES_PRODUCER,
  MAX_RETRY_TIME_MS,
  ACKs,
  Logger,
  logError,
} from "../commons";
import { Cluster } from "../cluster-utils";
import { getStreamingFunctions } from "../dmv2/internal";
import type { ConsumerConfig, TransformConfig, DeadLetterQueue } from "../dmv2";
import {
  buildFieldMutationsFromColumns,
  mutateParsedJson,
  type FieldMutations,
} from "../utilities/json";
import type { Column } from "../dataModels/dataModelTypes";

const HOSTNAME = process.env.HOSTNAME;
const AUTO_COMMIT_INTERVAL_MS = 5000;
const PARTITIONS_CONSUMED_CONCURRENTLY = 3;
const MAX_RETRIES_CONSUMER = 150;
const SESSION_TIMEOUT_CONSUMER = 30000;
const HEARTBEAT_INTERVAL_CONSUMER = 3000;
const DEFAULT_MAX_STREAMING_CONCURRENCY = 100;
// https://github.com/apache/kafka/blob/trunk/clients/src/main/java/org/apache/kafka/common/record/AbstractRecords.java#L124
// According to the above, the overhead should be 12 + 22 bytes - 34 bytes.
// We put 500 to be safe.
const KAFKAJS_BYTE_MESSAGE_OVERHEAD = 500;

/**
 * Checks if an error is a MESSAGE_TOO_LARGE error from Kafka
 */
const isMessageTooLargeError = (error: unknown): boolean => {
  // Check if it's a KafkaJS error first
  if (
    KafkaJS.isKafkaJSError &&
    error instanceof Error &&
    KafkaJS.isKafkaJSError(error)
  ) {
    return (
      (error as any).type === "ERR_MSG_SIZE_TOO_LARGE" ||
      (error as any).code === 10 ||
      ((error as any).cause !== undefined &&
        isMessageTooLargeError((error as any).cause))
    );
  }

  // Fallback for other error types that might have these properties
  if (error && typeof error === "object") {
    const err = error as any;
    return (
      err.type === "ERR_MSG_SIZE_TOO_LARGE" ||
      err.code === 10 ||
      (err.cause !== undefined && isMessageTooLargeError(err.cause))
    );
  }

  return false;
};

/**
 * Splits a batch of messages into smaller chunks when MESSAGE_TOO_LARGE error occurs
 */
const splitBatch = (
  messages: KafkaMessageWithLineage[],
  maxChunkSize: number,
): KafkaMessageWithLineage[][] => {
  if (messages.length <= 1) {
    return [messages];
  }

  // If we have more than one message, split into smaller batches
  const chunks: KafkaMessageWithLineage[][] = [];
  let currentChunk: KafkaMessageWithLineage[] = [];
  let currentSize = 0;

  for (const message of messages) {
    const messageSize =
      Buffer.byteLength(message.value, "utf8") + KAFKAJS_BYTE_MESSAGE_OVERHEAD;

    // If adding this message would exceed the limit, start a new chunk
    if (currentSize + messageSize > maxChunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [message];
      currentSize = messageSize;
    } else {
      currentChunk.push(message);
      currentSize += messageSize;
    }
  }

  // Add the last chunk if it has messages
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
};

/**
 * Sends a single chunk of messages with MESSAGE_TOO_LARGE error recovery
 */
const sendChunkWithRetry = async (
  logger: Logger,
  targetTopic: TopicConfig,
  producer: Producer,
  messages: KafkaMessageWithLineage[],
  currentMaxSize: number,
  maxRetries: number = 3,
): Promise<void> => {
  const currentMessages = messages;
  let attempts = 0;

  while (attempts < maxRetries) {
    try {
      await producer.send({
        topic: targetTopic.name,
        messages: currentMessages,
      });
      logger.log(
        `Successfully sent ${currentMessages.length} messages to ${targetTopic.name}`,
      );
      return;
    } catch (error) {
      if (isMessageTooLargeError(error) && currentMessages.length > 1) {
        logger.warn(
          `Got MESSAGE_TOO_LARGE error, splitting batch of ${currentMessages.length} messages and retrying (${maxRetries - attempts} attempts left)`,
        );

        // Split the batch into smaller chunks (use half the current max size)
        const newMaxSize = Math.floor(currentMaxSize / 2);
        const splitChunks = splitBatch(currentMessages, newMaxSize);

        // Send each split chunk recursively
        for (const chunk of splitChunks) {
          await sendChunkWithRetry(
            logger,
            targetTopic,
            producer,
            chunk,
            newMaxSize,
            // this error does not count as one failed attempt
            maxRetries - attempts,
          );
        }
        return;
      } else {
        attempts++;
        // If it's not MESSAGE_TOO_LARGE or we can't split further, re-throw
        if (attempts >= maxRetries) {
          // Before throwing, try to send all messages to DLQ if configured
          // We can only avoid throwing if ALL messages are successfully sent to their DLQs
          let messagesHandledByDLQ = 0;
          let messagesWithoutDLQ = 0;
          const dlqErrors: string[] = [];

          for (const failedMessage of currentMessages) {
            const dlqTopic = failedMessage.dlq;

            // Use the original input message, not the transformed output
            // to avoid making the DLQ message even larger
            if (dlqTopic && failedMessage.originalValue) {
              const dlqTopicName = dlqTopic.name;
              const deadLetterRecord = {
                originalRecord: {
                  ...failedMessage.originalValue,
                  // Include original Kafka message metadata
                  __sourcePartition: failedMessage.originalMessage.partition,
                  __sourceOffset: failedMessage.originalMessage.offset,
                  __sourceTimestamp: failedMessage.originalMessage.timestamp,
                },
                errorMessage:
                  error instanceof Error ? error.message : String(error),
                errorType:
                  error instanceof Error ? error.constructor.name : "Unknown",
                failedAt: new Date(),
                source: "transform",
              };

              cliLog({
                action: "DeadLetter",
                message: `Sending failed message to DLQ ${dlqTopicName}: ${error instanceof Error ? error.message : String(error)}`,
                message_type: "Error",
              });

              try {
                await producer.send({
                  topic: dlqTopicName,
                  messages: [{ value: JSON.stringify(deadLetterRecord) }],
                });
                logger.log(`Sent failed message to DLQ ${dlqTopicName}`);
                messagesHandledByDLQ++;
              } catch (dlqError) {
                const errorMsg = `Failed to send message to DLQ: ${dlqError}`;
                logger.error(errorMsg);
                dlqErrors.push(errorMsg);
              }
            } else if (!dlqTopic) {
              messagesWithoutDLQ++;
              logger.warn(
                `Cannot send to DLQ: no DLQ configured for message (batch has mixed DLQ configurations)`,
              );
            } else {
              messagesWithoutDLQ++;
              logger.warn(
                `Cannot send to DLQ: original message value not available`,
              );
            }
          }

          // Only suppress the error if ALL messages were successfully sent to their DLQs
          const allMessagesHandled =
            messagesHandledByDLQ === currentMessages.length &&
            messagesWithoutDLQ === 0 &&
            dlqErrors.length === 0;

          if (allMessagesHandled) {
            logger.log(
              `All ${messagesHandledByDLQ} failed message(s) sent to DLQ, not throwing original error`,
            );
            return;
          }

          // Otherwise, throw the original error because we couldn't handle all messages
          if (messagesWithoutDLQ > 0) {
            logger.error(
              `Cannot handle batch failure: ${messagesWithoutDLQ} message(s) have no DLQ configured`,
            );
          }
          if (dlqErrors.length > 0) {
            logger.error(
              `Some messages failed to send to DLQ: ${dlqErrors.join(", ")}`,
            );
          }
          if (messagesHandledByDLQ > 0) {
            logger.warn(
              `Partial DLQ success: ${messagesHandledByDLQ}/${currentMessages.length} message(s) sent to DLQ, but throwing due to incomplete batch handling`,
            );
          }
          throw error;
        }
        logger.warn(
          `Send ${currentMessages.length} messages failed (attempt ${attempts}/${maxRetries}), retrying: ${error}`,
        );
        // Wait briefly before retrying
        await new Promise((resolve) => setTimeout(resolve, 100 * attempts));
      }
    }
  }
};

/**
 * Data structure for metrics logging containing counts and metadata
 */
type MetricsData = {
  count_in: number;
  count_out: number;
  bytes: number;
  function_name: string;
  timestamp: Date;
};

/**
 * Interface for tracking message processing metrics
 */
interface Metrics {
  count_in: number;
  count_out: number;
  bytes: number;
}

/**
 * Type definition for streaming transformation function
 */
type StreamingFunction = (data: unknown) => unknown | Promise<unknown>;

/**
 * Simplified Kafka message type containing only value
 */
type KafkaMessageWithLineage = {
  value: string;
  originalValue: object;
  originalMessage: KafkaMessage;
  dlq?: DeadLetterQueue<any>;
};

/**
 * Configuration interface for Kafka topics including namespace and version support
 */
export interface TopicConfig {
  name: string; // Full topic name including namespace if present
  partitions: number;
  retention_ms: number;
  max_message_bytes: number;
  namespace?: string;
  version?: string;
}

/**
 * Configuration interface for streaming function arguments
 */
export interface StreamingFunctionArgs {
  sourceTopic: TopicConfig;
  targetTopic?: TopicConfig;
  functionFilePath: string;
  broker: string; // Comma-separated list of Kafka broker addresses (e.g., "broker1:9092, broker2:9092"). Whitespace around commas is automatically trimmed.
  maxSubscriberCount: number;
  isDmv2: boolean;
  saslUsername?: string;
  saslPassword?: string;
  saslMechanism?: string;
  securityProtocol?: string;
}

/**
 * Maximum number of concurrent streaming operations, configurable via environment
 */
const MAX_STREAMING_CONCURRENCY =
  process.env.MAX_STREAMING_CONCURRENCY ?
    parseInt(process.env.MAX_STREAMING_CONCURRENCY, 10)
  : DEFAULT_MAX_STREAMING_CONCURRENCY;

/**
 * Logs metrics data to HTTP endpoint
 */
export const metricsLog: (log: MetricsData) => void = (log) => {
  const req = http.request({
    port: parseInt(process.env.MOOSE_MANAGEMENT_PORT ?? "5001", 10),
    method: "POST",
    path: "/metrics-logs",
  });

  req.on("error", (err: Error) => {
    console.log(
      `Error ${err.name} sending metrics to management port.`,
      err.message,
    );
  });

  req.write(JSON.stringify({ ...log }));
  req.end();
};

/**
 * Initializes and connects Kafka producer
 */
const startProducer = async (
  logger: Logger,
  producer: Producer,
): Promise<void> => {
  try {
    logger.log("Connecting producer...");
    await producer.connect();
    logger.log("Producer is running...");
  } catch (error) {
    logger.error("Failed to connect producer:");
    if (error instanceof Error) {
      logError(logger, error);
    }
    throw error;
  }
};

/**
 * Disconnects a Kafka producer and logs the shutdown
 *
 * @param logger - Logger instance for outputting producer status
 * @param producer - KafkaJS Producer instance to disconnect
 * @returns Promise that resolves when producer is disconnected
 * @example
 * ```ts
 * await stopProducer(logger, producer); // Disconnects producer and logs shutdown
 * ```
 */
const stopProducer = async (
  logger: Logger,
  producer: Producer,
): Promise<void> => {
  await producer.disconnect();
  logger.log("Producer is shutting down...");
};

/**
 * Gracefully stops a Kafka consumer by pausing all partitions and then disconnecting
 *
 * @param logger - Logger instance for outputting consumer status
 * @param consumer - KafkaJS Consumer instance to disconnect
 * @param sourceTopic - Topic configuration containing name and partition count
 * @returns Promise that resolves when consumer is disconnected
 * @example
 * ```ts
 * await stopConsumer(logger, consumer, sourceTopic); // Pauses all partitions and disconnects consumer
 * ```
 */
const stopConsumer = async (
  logger: Logger,
  consumer: Consumer,
  sourceTopic: TopicConfig,
): Promise<void> => {
  try {
    // Try to pause the consumer first if the method exists
    logger.log("Pausing consumer...");

    // Generate partition numbers array based on the topic's partition count
    const partitionNumbers = Array.from(
      { length: sourceTopic.partitions },
      (_, i) => i,
    );

    await consumer.pause([
      {
        topic: sourceTopic.name,
        partitions: partitionNumbers,
      },
    ]);

    logger.log("Disconnecting consumer...");
    await consumer.disconnect();
    logger.log("Consumer is shutting down...");
  } catch (error) {
    logger.error(`Error during consumer shutdown: ${error}`);
    // Continue with disconnect even if pause fails
    try {
      await consumer.disconnect();
      logger.log("Consumer disconnected after error");
    } catch (disconnectError) {
      logger.error(`Failed to disconnect consumer: ${disconnectError}`);
    }
  }
};

/**
 * Processes a single Kafka message through a streaming function and returns transformed message(s)
 *
 * @param logger - Logger instance for outputting message processing status and errors
 * @param streamingFunctionWithConfigList - functions (with their configs) that transforms input message data
 * @param message - Kafka message to be processed
 * @param producer - Kafka producer for sending dead letter
 * @param fieldMutations - Pre-built field handlings for data transformations
 * @returns Promise resolving to array of transformed messages or undefined if processing fails
 *
 * The function will:
 * 1. Check for null/undefined message values
 * 2. Parse the message value as JSON
 * 3. Apply field handlings (e.g., date parsing) using pre-built configuration
 * 4. Pass parsed data through the streaming function
 * 5. Convert transformed data back to string format
 * 6. Handle both single and array return values
 * 7. Log any processing errors
 */
const handleMessage = async (
  logger: Logger,
  // Note: TransformConfig<any> is intentionally generic here as it handles
  // various data model types that are determined at runtime
  streamingFunctionWithConfigList: [StreamingFunction, TransformConfig<any>][],
  message: KafkaMessage,
  producer: Producer,
  fieldMutations?: FieldMutations,
): Promise<KafkaMessageWithLineage[] | undefined> => {
  if (message.value === undefined || message.value === null) {
    logger.log(`Received message with no value, skipping...`);
    return undefined;
  }

  try {
    // Detect Schema Registry JSON envelope: 0x00 + 4-byte schema ID (big-endian) + JSON bytes
    let payloadBuffer = message.value as Buffer;
    if (
      payloadBuffer &&
      payloadBuffer.length >= 5 &&
      payloadBuffer[0] === 0x00
    ) {
      payloadBuffer = payloadBuffer.subarray(5);
    }
    // Parse JSON then apply field handlings using pre-built configuration
    const parsedData = JSON.parse(payloadBuffer.toString());
    mutateParsedJson(parsedData, fieldMutations);
    const transformedData = await Promise.all(
      streamingFunctionWithConfigList.map(async ([fn, config]) => {
        try {
          return await fn(parsedData);
        } catch (e) {
          // Check if there's a deadLetterQueue configured
          const deadLetterQueue = config.deadLetterQueue;

          if (deadLetterQueue) {
            // Create a dead letter record
            const deadLetterRecord = {
              originalRecord: {
                ...parsedData,
                // Include original Kafka message metadata
                __sourcePartition: message.partition,
                __sourceOffset: message.offset,
                __sourceTimestamp: message.timestamp,
              },
              errorMessage: e instanceof Error ? e.message : String(e),
              errorType: e instanceof Error ? e.constructor.name : "Unknown",
              failedAt: new Date(),
              source: "transform",
            };

            cliLog({
              action: "DeadLetter",
              message: `Sending message to DLQ ${deadLetterQueue.name}: ${e instanceof Error ? e.message : String(e)}`,
              message_type: "Error",
            });
            // Send to the DLQ
            try {
              await producer.send({
                topic: deadLetterQueue.name,
                messages: [{ value: JSON.stringify(deadLetterRecord) }],
              });
            } catch (dlqError) {
              logger.error(`Failed to send to dead letter queue: ${dlqError}`);
            }
          } else {
            // No DLQ configured, just log the error
            cliLog({
              action: "Function",
              message: `Error processing message (no DLQ configured): ${e instanceof Error ? e.message : String(e)}`,
              message_type: "Error",
            });
          }

          // rethrow for the outside error handling
          throw e;
        }
      }),
    );

    return transformedData
      .map((userFunctionOutput, i) => {
        const [_, config] = streamingFunctionWithConfigList[i];
        if (userFunctionOutput) {
          if (Array.isArray(userFunctionOutput)) {
            // We Promise.all streamingFunctionWithConfigList above.
            // Promise.all always wraps results in an array, even for single transforms.
            // When a transform returns an array (e.g., [msg1, msg2] to emit multiple messages),
            // we get [[msg1, msg2]]. flat() unwraps one level so each item becomes its own message.
            // Without flat(), the entire array would be JSON.stringify'd as a single message.
            return userFunctionOutput
              .flat()
              .filter((item) => item !== undefined && item !== null)
              .map((item) => ({
                value: JSON.stringify(item),
                originalValue: parsedData,
                originalMessage: message,
                dlq: config.deadLetterQueue ?? undefined,
              }));
          } else {
            return [
              {
                value: JSON.stringify(userFunctionOutput),
                originalValue: parsedData,
                originalMessage: message,
                dlq: config.deadLetterQueue ?? undefined,
              },
            ];
          }
        }
      })
      .flat()
      .filter((item) => item !== undefined && item !== null);
  } catch (e) {
    // TODO: Track failure rate
    logger.error(`Failed to transform data`);
    if (e instanceof Error) {
      logError(logger, e);
    }
  }

  return undefined;
};

/**
 * Sends processed messages to a target Kafka topic in chunks to respect max message size limits
 *
 * @param logger - Logger instance for outputting send status and errors
 * @param metrics - Metrics object for tracking message counts and bytes sent
 * @param targetTopic - Target topic configuration
 * @param producer - KafkaJS Producer instance for sending messages
 * @param messages - Array of processed messages to send (messages carry their own DLQ config)
 * @returns Promise that resolves when all messages are sent
 *
 * The function will:
 * 1. Split messages into chunks that fit within maxMessageSize
 * 2. Send each chunk to the target topic
 * 3. Track metrics for bytes sent and message counts
 * 4. Log success/failure of sends
 * 5. Send failed messages to DLQ if configured in message lineage
 */
const sendMessages = async (
  logger: Logger,
  metrics: Metrics,
  targetTopic: TopicConfig,
  producer: Producer,
  messages: KafkaMessageWithLineage[],
): Promise<void> => {
  try {
    let chunk: KafkaMessageWithLineage[] = [];
    let chunkSize = 0;

    const maxMessageSize = targetTopic.max_message_bytes || 1024 * 1024;

    for (const message of messages) {
      const messageSize =
        Buffer.byteLength(message.value, "utf8") +
        KAFKAJS_BYTE_MESSAGE_OVERHEAD;

      if (chunkSize + messageSize > maxMessageSize) {
        logger.log(
          `Sending ${chunkSize} bytes of a transformed record batch to ${targetTopic.name}`,
        );
        // Send the current chunk before adding the new message
        await sendChunkWithRetry(
          logger,
          targetTopic,
          producer,
          chunk,
          maxMessageSize,
        );
        logger.log(
          `Sent ${chunk.length} transformed records to ${targetTopic.name}`,
        );

        // Start a new chunk
        chunk = [message];
        chunkSize = messageSize;
      } else {
        // Add the new message to the current chunk
        chunk.push(message);
        metrics.bytes += Buffer.byteLength(message.value, "utf8");
        chunkSize += messageSize;
      }
    }

    metrics.count_out += chunk.length;

    // Send the last chunk
    if (chunk.length > 0) {
      logger.log(
        `Sending ${chunkSize} bytes of a transformed record batch to ${targetTopic.name}`,
      );
      await sendChunkWithRetry(
        logger,
        targetTopic,
        producer,
        chunk,
        maxMessageSize,
      );
      logger.log(
        `Sent final ${chunk.length} transformed data to ${targetTopic.name}`,
      );
    }
  } catch (e) {
    logger.error(`Failed to send transformed data`);
    if (e instanceof Error) {
      logError(logger, e);
    }
    // This is needed for retries
    throw e;
  }
};

/**
 * Periodically sends metrics about message processing to a metrics logging endpoint.
 * Resets metrics counters after each send. Runs every second via setTimeout.
 *
 * @param logger - Logger instance containing the function name prefix
 * @param metrics - Metrics object tracking message counts and bytes processed
 * @example
 * ```ts
 * const metrics = { count_in: 10, count_out: 8, bytes: 1024 };
 * sendMessageMetrics(logger, metrics); // Sends metrics and resets counters
 * ```
 */
const sendMessageMetrics = (logger: Logger, metrics: Metrics) => {
  if (metrics.count_in > 0 || metrics.count_out > 0 || metrics.bytes > 0) {
    metricsLog({
      count_in: metrics.count_in,
      count_out: metrics.count_out,
      function_name: logger.logPrefix,
      bytes: metrics.bytes,
      timestamp: new Date(),
    });
  }
  metrics.count_in = 0;
  metrics.bytes = 0;
  metrics.count_out = 0;
  setTimeout(() => sendMessageMetrics(logger, metrics), 1000);
};

/**
 * Dynamically loads a streaming function from a file path
 *
 * @param args - The streaming function arguments containing the function file path
 * @returns The default export of the streaming function module
 * @throws Will throw and log an error if the function file cannot be loaded
 * @example
 * ```ts
 * const fn = loadStreamingFunction({functionFilePath: './transform.js'});
 * const result = await fn(data);
 * ```
 */
function loadStreamingFunction(functionFilePath: string) {
  let streamingFunctionImport: { default: StreamingFunction };
  try {
    streamingFunctionImport = require(
      functionFilePath.substring(0, functionFilePath.length - 3),
    );
  } catch (e) {
    cliLog({ action: "Function", message: `${e}`, message_type: "Error" });
    throw e;
  }
  return streamingFunctionImport.default;
}

async function loadStreamingFunctionV2(
  sourceTopic: TopicConfig,
  targetTopic?: TopicConfig,
): Promise<{
  functions: [StreamingFunction, TransformConfig<any> | ConsumerConfig<any>][];
  fieldMutations: FieldMutations | undefined;
}> {
  const transformFunctions = await getStreamingFunctions();
  const transformFunctionKey = `${topicNameToStreamName(sourceTopic)}_${targetTopic ? topicNameToStreamName(targetTopic) : "<no-target>"}`;

  const matchingEntries = Array.from(transformFunctions.entries()).filter(
    ([key]) => key.startsWith(transformFunctionKey),
  );

  if (matchingEntries.length === 0) {
    const message = `No functions found for ${transformFunctionKey}`;
    cliLog({
      action: "Function",
      message: `${message}`,
      message_type: "Error",
    });
    throw new Error(message);
  }

  // Extract functions and configs, and get columns from the first entry
  // (all functions for the same source topic will have the same columns)
  const functions = matchingEntries.map(([_, [fn, config]]) => [
    fn,
    config,
  ]) as [StreamingFunction, TransformConfig<any> | ConsumerConfig<any>][];
  const [_key, firstEntry] = matchingEntries[0];
  const sourceColumns = firstEntry[2];

  // Pre-build field handlings once for all messages
  const fieldMutations = buildFieldMutationsFromColumns(sourceColumns);

  return { functions, fieldMutations };
}

/**
 * Initializes and starts a Kafka consumer that processes messages using a streaming function
 *
 * @param logger - Logger instance for outputting consumer status and errors
 * @param metrics - Metrics object for tracking message counts and bytes processed
 * @param parallelism - Number of parallel workers processing messages
 * @param args - Configuration arguments for source/target topics and streaming function
 * @param consumer - KafkaJS Consumer instance
 * @param producer - KafkaJS Producer instance for sending processed messages
 * @param streamingFuncId - Unique identifier for this consumer group
 * @param maxMessageSize - Maximum message size in bytes allowed by Kafka broker
 * @returns Promise that resolves when consumer is started
 *
 * The consumer will:
 * 1. Connect to Kafka
 * 2. Subscribe to the source topic
 * 3. Process messages in batches using the streaming function
 * 4. Send processed messages to target topic (if configured)
 * 5. Commit offsets after successful processing
 */
const startConsumer = async (
  args: StreamingFunctionArgs,
  logger: Logger,
  metrics: Metrics,
  _parallelism: number,
  consumer: Consumer,
  producer: Producer,
  streamingFuncId: string,
): Promise<void> => {
  // Validate topic configurations
  validateTopicConfig(args.sourceTopic);
  if (args.targetTopic) {
    validateTopicConfig(args.targetTopic);
  }

  try {
    logger.log("Connecting consumer...");
    await consumer.connect();
    logger.log("Consumer connected successfully");
  } catch (error) {
    logger.error("Failed to connect consumer:");
    if (error instanceof Error) {
      logError(logger, error);
    }
    throw error;
  }

  logger.log(
    `Starting consumer group '${streamingFuncId}' with source topic: ${args.sourceTopic.name} and target topic: ${args.targetTopic?.name || "none"}`,
  );

  // We preload the function to not have to load it for each message
  // Note: Config types use 'any' as generics because they handle various
  // data model types determined at runtime, not compile time
  let streamingFunctions: [
    StreamingFunction,
    TransformConfig<any> | ConsumerConfig<any>,
  ][];
  let fieldMutations: FieldMutations | undefined;

  if (args.isDmv2) {
    const result = await loadStreamingFunctionV2(
      args.sourceTopic,
      args.targetTopic,
    );
    streamingFunctions = result.functions;
    fieldMutations = result.fieldMutations;
  } else {
    streamingFunctions = [[loadStreamingFunction(args.functionFilePath), {}]];
    fieldMutations = undefined;
  }

  await consumer.subscribe({
    topics: [args.sourceTopic.name], // Use full topic name for Kafka operations
  });

  await consumer.run({
    eachBatchAutoResolve: true,
    // Enable parallel processing of partitions
    partitionsConsumedConcurrently: PARTITIONS_CONSUMED_CONCURRENTLY, // To be adjusted
    eachBatch: async ({ batch, heartbeat, isRunning, isStale }) => {
      if (!isRunning() || isStale()) {
        return;
      }

      metrics.count_in += batch.messages.length;

      cliLog({
        action: "Received",
        message: `${logger.logPrefix} ${batch.messages.length} message(s)`,
      });
      logger.log(`Received ${batch.messages.length} message(s)`);

      let index = 0;
      const readableStream = Readable.from(batch.messages);

      const processedMessages: (KafkaMessageWithLineage[] | undefined)[] =
        await readableStream
          .map(
            async (message) => {
              index++;
              if (
                (batch.messages.length > DEFAULT_MAX_STREAMING_CONCURRENCY &&
                  index % DEFAULT_MAX_STREAMING_CONCURRENCY) ||
                index - 1 === batch.messages.length
              ) {
                await heartbeat();
              }
              return handleMessage(
                logger,
                streamingFunctions,
                message,
                producer,
                fieldMutations,
              );
            },
            {
              concurrency: MAX_STREAMING_CONCURRENCY,
            },
          )
          .toArray();

      const filteredMessages = processedMessages
        .flat()
        .filter((msg) => msg !== undefined && msg.value !== undefined);

      if (args.targetTopic === undefined || processedMessages.length === 0) {
        return;
      }

      await heartbeat();

      if (filteredMessages.length > 0) {
        // Messages now carry their own DLQ configuration in the lineage
        await sendMessages(
          logger,
          metrics,
          args.targetTopic,
          producer,
          filteredMessages as KafkaMessageWithLineage[],
        );
      }
    },
  });

  logger.log("Consumer is running...");
};

/**
 * Creates a Logger instance that prefixes all log messages with the source and target topic
 *
 * @param args - The streaming function arguments containing source and target topics
 * @returns A Logger instance with standard log, error and warn methods
 * @example
 * ```ts
 * const logger = buildLogger({sourceTopic: 'source', targetTopic: 'target'});
 * logger.log('message'); // Outputs: "source -> target: message"
 * ```
 */
const buildLogger = (args: StreamingFunctionArgs, workerId: number): Logger => {
  const targetLabel =
    args.targetTopic?.name ? ` -> ${args.targetTopic.name}` : " (consumer)";
  const logPrefix = `${args.sourceTopic.name}${targetLabel} (worker ${workerId})`;
  return {
    logPrefix: logPrefix,
    log: (message: string): void => {
      console.log(`${logPrefix}: ${message}`);
    },
    error: (message: string): void => {
      console.error(`${logPrefix}: ${message}`);
    },
    warn: (message: string): void => {
      console.warn(`${logPrefix}: ${message}`);
    },
  };
};

/**
 * Formats a version string into a topic suffix format by replacing dots with underscores
 * Example: "1.2.3" -> "_1_2_3"
 */
export function formatVersionSuffix(version: string): string {
  return `_${version.replace(/\./g, "_")}`;
}

/**
 * Transforms a topic name by removing namespace prefix and version suffix
 * to get the base stream name for function mapping
 */
export function topicNameToStreamName(config: TopicConfig): string {
  let name = config.name;

  // Handle version suffix if present
  if (config.version) {
    const versionSuffix = formatVersionSuffix(config.version);
    if (name.endsWith(versionSuffix)) {
      name = name.slice(0, -versionSuffix.length);
    } else {
      throw new Error(
        `Version suffix ${versionSuffix} not found in topic name ${name}`,
      );
    }
  }

  // Handle namespace prefix if present
  if (config.namespace && config.namespace !== "") {
    const prefix = `${config.namespace}.`;
    if (name.startsWith(prefix)) {
      name = name.slice(prefix.length);
    } else {
      throw new Error(
        `Namespace prefix ${prefix} not found in topic name ${name}`,
      );
    }
  }

  return name;
}

/**
 * Validates a topic configuration for proper namespace and version formatting
 */
export function validateTopicConfig(config: TopicConfig): void {
  if (config.namespace && !config.name.startsWith(`${config.namespace}.`)) {
    throw new Error(
      `Topic name ${config.name} must start with namespace ${config.namespace}`,
    );
  }

  if (config.version) {
    const versionSuffix = formatVersionSuffix(config.version);
    if (!config.name.endsWith(versionSuffix)) {
      throw new Error(
        `Topic name ${config.name} must end with version ${config.version}`,
      );
    }
  }
}

/**
 * Initializes and runs a clustered streaming function system that processes messages from Kafka
 *
 * This function:
 * 1. Creates a cluster of workers to handle Kafka message processing
 * 2. Sets up Kafka producers and consumers for each worker
 * 3. Configures logging and metrics collection
 * 4. Handles graceful shutdown on termination
 *
 * The system supports:
 * - Multiple workers processing messages in parallel
 * - Dynamic CPU usage control via maxCpuUsageRatio
 * - SASL authentication for Kafka
 * - Metrics tracking for message counts and bytes processed
 * - Graceful shutdown of Kafka connections
 *
 * @returns Promise that resolves when the cluster is started
 * @throws Will log errors if Kafka connections fail
 *
 * @example
 * ```ts
 * await runStreamingFunctions({
 *   sourceTopic: { name: 'source', partitions: 3, retentionPeriod: 86400, maxMessageBytes: 1048576 },
 *   targetTopic: { name: 'target', partitions: 3, retentionPeriod: 86400, maxMessageBytes: 1048576 },
 *   functionFilePath: './transform.js',
 *   broker: 'localhost:9092',
 *   maxSubscriberCount: 3,
 *   isDmv2: false
 * }); // Starts the streaming function cluster
 * ```
 */
export const runStreamingFunctions = async (
  args: StreamingFunctionArgs,
): Promise<void> => {
  // Validate topic configurations at startup
  validateTopicConfig(args.sourceTopic);
  if (args.targetTopic) {
    validateTopicConfig(args.targetTopic);
  }

  // Use base stream names (without namespace/version) for function ID
  // We use flow- instead of function- because that's what the ACLs in boreal are linked with
  // When migrating - make sure the ACLs are updated to use the new prefix.
  const streamingFuncId = `flow-${args.sourceTopic.name}-${args.targetTopic?.name || ""}`;

  const cluster = new Cluster({
    maxCpuUsageRatio: 0.5,
    maxWorkerCount: args.maxSubscriberCount,
    workerStart: async (worker, parallelism) => {
      const logger = buildLogger(args, worker.id);

      const metrics = {
        count_in: 0,
        count_out: 0,
        bytes: 0,
      };

      setTimeout(() => sendMessageMetrics(logger, metrics), 1000);

      const clientIdPrefix = HOSTNAME ? `${HOSTNAME}-` : "";
      const processId = `${clientIdPrefix}${streamingFuncId}-ts-${worker.id}`;

      const kafka = await getKafkaClient(
        {
          clientId: processId,
          broker: args.broker,
          securityProtocol: args.securityProtocol,
          saslUsername: args.saslUsername,
          saslPassword: args.saslPassword,
          saslMechanism: args.saslMechanism,
        },
        logger,
      );

      const consumer: Consumer = kafka.consumer({
        kafkaJS: {
          groupId: streamingFuncId,
          sessionTimeout: SESSION_TIMEOUT_CONSUMER,
          heartbeatInterval: HEARTBEAT_INTERVAL_CONSUMER,
          retry: {
            retries: MAX_RETRIES_CONSUMER,
          },
          autoCommit: true,
          autoCommitInterval: AUTO_COMMIT_INTERVAL_MS,
          fromBeginning: true,
        },
      });

      const producer: Producer = kafka.producer({
        kafkaJS: {
          idempotent: true,
          acks: ACKs,
          retry: {
            retries: MAX_RETRIES_PRODUCER,
            maxRetryTime: MAX_RETRY_TIME_MS,
          },
        },
      });

      try {
        logger.log("Starting producer...");
        await startProducer(logger, producer);

        try {
          logger.log("Starting consumer...");
          await startConsumer(
            args,
            logger,
            metrics,
            parallelism,
            consumer,
            producer,
            streamingFuncId,
          );
        } catch (e) {
          logger.error("Failed to start kafka consumer: ");
          if (e instanceof Error) {
            logError(logger, e);
          }
          // Re-throw to ensure proper error handling
          throw e;
        }
      } catch (e) {
        logger.error("Failed to start kafka producer: ");
        if (e instanceof Error) {
          logError(logger, e);
        }
        // Re-throw to ensure proper error handling
        throw e;
      }

      return [logger, producer, consumer] as [Logger, Producer, Consumer];
    },
    workerStop: async ([logger, producer, consumer]) => {
      logger.log(`Received SIGTERM, shutting down gracefully...`);

      // First stop the consumer to prevent new messages
      logger.log("Stopping consumer first...");
      await stopConsumer(logger, consumer, args.sourceTopic);

      // Wait a bit for in-flight messages to complete processing
      logger.log("Waiting for in-flight messages to complete...");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Then stop the producer
      logger.log("Stopping producer...");
      await stopProducer(logger, producer);

      logger.log("Graceful shutdown completed");
    },
  });

  cluster.start();
};
