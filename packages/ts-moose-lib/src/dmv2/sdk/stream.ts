/**
 * @fileoverview Stream SDK for data streaming operations in Moose.
 *
 * This module provides the core streaming functionality including:
 * - Stream creation and configuration
 * - Message transformations between streams
 * - Consumer registration for message processing
 * - Dead letter queue handling for error recovery
 *
 * @module Stream
 */

import { IJsonSchemaCollection } from "typia";
import { TypedBase } from "../typedBase";
import { Column } from "../../dataModels/dataModelTypes";
import { dlqColumns, dlqSchema, getMooseInternal } from "../internal";
import { OlapTable } from "./olapTable";
import { LifeCycle } from "./lifeCycle";

/**
 * Represents zero, one, or many values of type T.
 * Used for flexible return types in transformations where a single input
 * can produce no output, one output, or multiple outputs.
 *
 * @template T The type of the value(s)
 * @example
 * ```typescript
 * // Can return a single value
 * const single: ZeroOrMany<string> = "hello";
 *
 * // Can return an array
 * const multiple: ZeroOrMany<string> = ["hello", "world"];
 *
 * // Can return null/undefined to filter out
 * const filtered: ZeroOrMany<string> = null;
 * ```
 */
export type ZeroOrMany<T> = T | T[] | undefined | null;

/**
 * Function type for transforming records from one type to another.
 * Supports both synchronous and asynchronous transformations.
 *
 * @template T The input record type
 * @template U The output record type
 * @param record The input record to transform
 * @returns The transformed record(s), or null/undefined to filter out
 *
 * @example
 * ```typescript
 * const transform: SyncOrAsyncTransform<InputType, OutputType> = (record) => {
 *   return { ...record, processed: true };
 * };
 * ```
 */
export type SyncOrAsyncTransform<T, U> = (
  record: T,
) => ZeroOrMany<U> | Promise<ZeroOrMany<U>>;

/**
 * Function type for consuming records without producing output.
 * Used for side effects like logging, external API calls, or database writes.
 *
 * @template T The record type to consume
 * @param record The record to process
 * @returns Promise<void> or void
 *
 * @example
 * ```typescript
 * const consumer: Consumer<UserEvent> = async (event) => {
 *   await sendToAnalytics(event);
 * };
 * ```
 */
export type Consumer<T> = (record: T) => Promise<void> | void;

/**
 * Configuration options for stream transformations.
 *
 * @template T The type of records being transformed
 */
export interface TransformConfig<T> {
  /**
   * Optional version identifier for this transformation.
   * Multiple transformations to the same destination can coexist with different versions.
   */
  version?: string;

  /**
   * Optional metadata for documentation and tracking purposes.
   */
  metadata?: { description?: string };

  /**
   * Optional dead letter queue for handling transformation failures.
   * Failed records will be sent to this queue for manual inspection or reprocessing.
   * Uses {@link Stream.defaultDeadLetterQueue} by default
   * unless a DeadLetterQueue is provided, or it is explicitly disabled with a null value
   */
  deadLetterQueue?: DeadLetterQueue<T> | null;
}

/**
 * Configuration options for stream consumers.
 *
 * @template T The type of records being consumed
 */
export interface ConsumerConfig<T> {
  /**
   * Optional version identifier for this consumer.
   * Multiple consumers can coexist with different versions.
   */
  version?: string;

  /**
   * Optional dead letter queue for handling consumer failures.
   * Failed records will be sent to this queue for manual inspection or reprocessing.
   * Uses {@link Stream.defaultDeadLetterQueue} by default
   * unless a DeadLetterQueue is provided, or it is explicitly disabled with a null value
   */
  deadLetterQueue?: DeadLetterQueue<T> | null;
}

/**
 * Represents a message routed to a specific destination stream.
 * Used internally by the multi-transform functionality to specify
 * where transformed messages should be sent.
 *
 * @internal
 */
class RoutedMessage {
  /** The destination stream for the message */
  destination: Stream<any>;

  /** The message value(s) to send */
  values: ZeroOrMany<any>;

  /**
   * Creates a new routed message.
   *
   * @param destination The target stream
   * @param values The message(s) to route
   */
  constructor(destination: Stream<any>, values: ZeroOrMany<any>) {
    this.destination = destination;
    this.values = values;
  }
}

/**
 * Configuration options for a data stream (e.g., a Redpanda topic).
 * @template T The data type of the messages in the stream.
 */
export interface StreamConfig<T> {
  /**
   * Specifies the number of partitions for the stream. Affects parallelism and throughput.
   */
  parallelism?: number;
  /**
   * Specifies the data retention period for the stream in seconds. Messages older than this may be deleted.
   */
  retentionPeriod?: number; // seconds
  /**
   * An optional destination OLAP table where messages from this stream should be automatically ingested.
   */
  destination?: OlapTable<T>;
  /**
   * An optional version string for this configuration. Can be used for tracking changes or managing deployments.
   */
  version?: string;
  metadata?: { description?: string };
  lifeCycle?: LifeCycle;

  defaultDeadLetterQueue?: DeadLetterQueue<T>;
}

/**
 * Represents a data stream, typically corresponding to a Redpanda topic.
 * Provides a typed interface for producing to and consuming from the stream, and defining transformations.
 *
 * @template T The data type of the messages flowing through the stream. The structure of T defines the message schema.
 */
export class Stream<T> extends TypedBase<T, StreamConfig<T>> {
  defaultDeadLetterQueue?: DeadLetterQueue<T>;

  /**
   * Creates a new Stream instance.
   * @param name The name of the stream. This name is used for the underlying Redpanda topic.
   * @param config Optional configuration for the stream.
   */
  constructor(name: string, config?: StreamConfig<T>);

  /** @internal **/
  constructor(
    name: string,
    config: StreamConfig<T>,
    schema: IJsonSchemaCollection.IV3_1,
    columns: Column[],
  );

  constructor(
    name: string,
    config?: StreamConfig<T>,
    schema?: IJsonSchemaCollection.IV3_1,
    columns?: Column[],
  ) {
    super(name, config ?? {}, schema, columns);
    const streams = getMooseInternal().streams;
    if (streams.has(name)) {
      throw new Error(`Stream with name ${name} already exists`);
    }
    streams.set(name, this);
    this.defaultDeadLetterQueue = this.config.defaultDeadLetterQueue;
  }

  /**
   * Internal map storing transformation configurations.
   * Maps destination stream names to arrays of transformation functions and their configs.
   *
   * @internal
   */
  _transformations = new Map<
    string,
    [Stream<any>, SyncOrAsyncTransform<T, any>, TransformConfig<T>][]
  >();

  /**
   * Internal function for multi-stream transformations.
   * Allows a single transformation to route messages to multiple destinations.
   *
   * @internal
   */
  _multipleTransformations?: (record: T) => [RoutedMessage];

  /**
   * Internal array storing consumer configurations.
   *
   * @internal
   */
  _consumers = new Array<{
    consumer: Consumer<T>;
    config: ConsumerConfig<T>;
  }>();

  /**
   * Adds a transformation step that processes messages from this stream and sends the results to a destination stream.
   * Multiple transformations to the same destination stream can be added if they have distinct `version` identifiers in their config.
   *
   * @template U The data type of the messages in the destination stream.
   * @param destination The destination stream for the transformed messages.
   * @param transformation A function that takes a message of type T and returns zero or more messages of type U (or a Promise thereof).
   *                       Return `null` or `undefined` or an empty array `[]` to filter out a message. Return an array to emit multiple messages.
   * @param config Optional configuration for this specific transformation step, like a version.
   */
  addTransform<U>(
    destination: Stream<U>,
    transformation: SyncOrAsyncTransform<T, U>,
    config?: TransformConfig<T>,
  ) {
    const transformConfig = {
      ...(config ?? {}),
    };
    if (transformConfig.deadLetterQueue === undefined) {
      transformConfig.deadLetterQueue = this.defaultDeadLetterQueue;
    }

    if (this._transformations.has(destination.name)) {
      const existingTransforms = this._transformations.get(destination.name)!;
      const hasVersion = existingTransforms.some(
        ([_, __, cfg]) => cfg.version === transformConfig.version,
      );

      if (!hasVersion) {
        existingTransforms.push([destination, transformation, transformConfig]);
      }
    } else {
      this._transformations.set(destination.name, [
        [destination, transformation, transformConfig],
      ]);
    }
  }

  /**
   * Adds a consumer function that processes messages from this stream.
   * Multiple consumers can be added if they have distinct `version` identifiers in their config.
   *
   * @param consumer A function that takes a message of type T and performs an action (e.g., side effect, logging). Should return void or Promise<void>.
   * @param config Optional configuration for this specific consumer, like a version.
   */
  addConsumer(consumer: Consumer<T>, config?: ConsumerConfig<T>) {
    const consumerConfig = {
      ...(config ?? {}),
    };
    if (consumerConfig.deadLetterQueue === undefined) {
      consumerConfig.deadLetterQueue = this.defaultDeadLetterQueue;
    }
    const hasVersion = this._consumers.some(
      (existing) => existing.config.version === consumerConfig.version,
    );

    if (!hasVersion) {
      this._consumers.push({ consumer, config: consumerConfig });
    }
  }

  /**
   * Helper method for `addMultiTransform` to specify the destination and values for a routed message.
   * @param values The value or values to send to this stream.
   * @returns A `RoutedMessage` object associating the values with this stream.
   *
   * @example
   * ```typescript
   * sourceStream.addMultiTransform((record) => [
   *   destinationStream1.routed(transformedRecord1),
   *   destinationStream2.routed([record2a, record2b])
   * ]);
   * ```
   */
  routed = (values: ZeroOrMany<T>) => new RoutedMessage(this, values);

  /**
   * Adds a single transformation function that can route messages to multiple destination streams.
   * This is an alternative to adding multiple individual `addTransform` calls.
   * Only one multi-transform function can be added per stream.
   *
   * @param transformation A function that takes a message of type T and returns an array of `RoutedMessage` objects,
   *                       each specifying a destination stream and the message(s) to send to it.
   */
  addMultiTransform(transformation: (record: T) => [RoutedMessage]) {
    this._multipleTransformations = transformation;
  }
}

/**
 * Base model for dead letter queue entries.
 * Contains the original failed record along with error information.
 */
export interface DeadLetterModel {
  /** The original record that failed processing */
  originalRecord: Record<string, any>;

  /** Human-readable error message describing the failure */
  errorMessage: string;

  /** Classification of the error type (e.g., "ValidationError", "TransformError") */
  errorType: string;

  /** Timestamp when the failure occurred */
  failedAt: Date;

  /** The source component where the failure occurred */
  source: "api" | "transform" | "table";
}

/**
 * Enhanced dead letter model with type recovery functionality.
 * Extends the base model with the ability to recover the original typed record.
 *
 * @template T The original record type before failure
 */
export interface DeadLetter<T> extends DeadLetterModel {
  /**
   * Recovers the original record as its typed form.
   * Useful for reprocessing failed records with proper type safety.
   *
   * @returns The original record cast to type T
   */
  asTyped: () => T;
}

/**
 * Internal function to attach type guard functionality to dead letter records.
 *
 * @internal
 * @template T The original record type
 * @param dl The dead letter model to enhance
 * @param typeGuard Function to validate and cast the original record
 */
function attachTypeGuard<T>(
  dl: DeadLetterModel,
  typeGuard: (input: any) => T,
): asserts dl is DeadLetter<T> {
  (dl as any).asTyped = () => typeGuard(dl.originalRecord);
}

/**
 * Specialized stream for handling failed records (dead letters).
 * Provides type-safe access to failed records for reprocessing or analysis.
 *
 * @template T The original record type that failed processing
 *
 * @example
 * ```typescript
 * const dlq = new DeadLetterQueue<UserEvent>("user-events-dlq");
 *
 * dlq.addConsumer(async (deadLetter) => {
 *   const originalEvent = deadLetter.asTyped();
 *   console.log(`Failed event: ${deadLetter.errorMessage}`);
 *   // Potentially reprocess or alert
 * });
 * ```
 */
export class DeadLetterQueue<T> extends Stream<DeadLetterModel> {
  /**
   * Creates a new DeadLetterQueue instance.
   * @param name The name of the dead letter queue stream
   * @param config Optional configuration for the stream. The metadata property is always present and includes stackTrace.
   */
  constructor(name: string, config?: StreamConfig<DeadLetterModel>);

  /** @internal **/
  constructor(
    name: string,
    config: StreamConfig<DeadLetterModel>,
    validate: (originalRecord: any) => T,
  );

  constructor(
    name: string,
    config?: StreamConfig<DeadLetterModel>,
    typeGuard?: (originalRecord: any) => T,
  ) {
    if (typeGuard === undefined) {
      throw new Error(
        "Supply the type param T so that the schema is inserted by the compiler plugin.",
      );
    }

    super(name, config ?? {}, dlqSchema, dlqColumns);
    this.typeGuard = typeGuard;
    getMooseInternal().streams.set(name, this);
  }

  /**
   * Internal type guard function for validating and casting original records.
   *
   * @internal
   */
  private typeGuard: (originalRecord: any) => T;

  /**
   * Adds a transformation step for dead letter records.
   * The transformation function receives a DeadLetter<T> with type recovery capabilities.
   *
   * @template U The output type for the transformation
   * @param destination The destination stream for transformed messages
   * @param transformation Function to transform dead letter records
   * @param config Optional transformation configuration
   */
  addTransform<U>(
    destination: Stream<U>,
    transformation: SyncOrAsyncTransform<DeadLetter<T>, U>,
    config?: TransformConfig<DeadLetterModel>,
  ) {
    const withValidate: SyncOrAsyncTransform<DeadLetterModel, U> = (
      deadLetter,
    ) => {
      attachTypeGuard<T>(deadLetter, this.typeGuard);
      return transformation(deadLetter);
    };
    super.addTransform(destination, withValidate, config);
  }

  /**
   * Adds a consumer for dead letter records.
   * The consumer function receives a DeadLetter<T> with type recovery capabilities.
   *
   * @param consumer Function to process dead letter records
   * @param config Optional consumer configuration
   */
  addConsumer(
    consumer: Consumer<DeadLetter<T>>,
    config?: ConsumerConfig<DeadLetterModel>,
  ) {
    const withValidate: Consumer<DeadLetterModel> = (deadLetter) => {
      attachTypeGuard<T>(deadLetter, this.typeGuard);
      return consumer(deadLetter);
    };
    super.addConsumer(withValidate, config);
  }

  /**
   * Adds a multi-stream transformation for dead letter records.
   * The transformation function receives a DeadLetter<T> with type recovery capabilities.
   *
   * @param transformation Function to route dead letter records to multiple destinations
   */
  addMultiTransform(
    transformation: (record: DeadLetter<T>) => [RoutedMessage],
  ) {
    const withValidate: (record: DeadLetterModel) => [RoutedMessage] = (
      deadLetter,
    ) => {
      attachTypeGuard<T>(deadLetter, this.typeGuard);
      return transformation(deadLetter);
    };
    super.addMultiTransform(withValidate);
  }
}
