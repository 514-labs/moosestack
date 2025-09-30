import { IJsonSchemaCollection } from "typia";
import { TypedBase, TypiaValidators } from "../typedBase";
import { Column } from "../../dataModels/dataModelTypes";
import {
  DeadLetterModel,
  DeadLetterQueue,
  Stream,
  StreamConfig,
} from "./stream";
import { OlapConfig, OlapTable } from "./olapTable";
import { IngestApi, IngestConfig } from "./ingestApi";
import { LifeCycle } from "./lifeCycle";
import { ClickHouseEngines } from "../../blocks/helpers";

/**
 * Configuration options for a complete ingestion pipeline, potentially including an Ingest API, a Stream, and an OLAP Table.
 *
 * @template T The data type of the records being ingested.
 *
 * @example
 * ```typescript
 * // Simple pipeline with all components enabled
 * const pipelineConfig: IngestPipelineConfig<UserData> = {
 *   table: true,
 *   stream: true,
 *   ingestAPI: true
 * };
 *
 * // Advanced pipeline with custom configurations
 * const advancedConfig: IngestPipelineConfig<UserData> = {
 *   table: { orderByFields: ['timestamp', 'userId'], engine: ClickHouseEngines.ReplacingMergeTree },
 *   stream: { parallelism: 4, retentionPeriod: 86400 },
 *   ingestAPI: true,
 *   version: '1.2.0',
 *   metadata: { description: 'User data ingestion pipeline' }
 * };
 * ```
 */
export type IngestPipelineConfig<T> = {
  /**
   * Configuration for the OLAP table component of the pipeline.
   *
   * - If `true`, a table with default settings is created.
   * - If an `OlapConfig` object is provided, it specifies the table's configuration.
   * - If `false`, no OLAP table is created.
   *
   * @default false
   */
  table: boolean | OlapConfig<T>;

  /**
   * Configuration for the stream component of the pipeline.
   *
   * - If `true`, a stream with default settings is created.
   * - Pass a config object to specify the stream's configuration.
   * - The stream's destination will automatically be set to the pipeline's table if one exists.
   * - If `false`, no stream is created.
   *
   * @default false
   */
  stream: boolean | Omit<StreamConfig<T>, "destination">;

  /**
   * Configuration for the ingest API component of the pipeline.
   *
   * - If `true`, an ingest API with default settings is created.
   * - If a partial `IngestConfig` object (excluding `destination`) is provided, it specifies the API's configuration.
   * - The API's destination will automatically be set to the pipeline's stream if one exists.
   * - If `false`, no ingest API is created.
   *
   * **Note:** Requires a stream to be configured when enabled.
   *
   * @default false
   */
  ingestAPI: boolean | Omit<IngestConfig<T>, "destination">;

  /**
   * @deprecated Use `ingestAPI` instead. This parameter will be removed in a future version.
   */
  ingest?: boolean | Omit<IngestConfig<T>, "destination">;

  /**
   * Configuration for the dead letter queue of the pipeline.
   * If `true`, a dead letter queue with default settings is created.
   * If a partial `StreamConfig` object (excluding `destination`) is provided, it specifies the dead letter queue's configuration.
   * The API's destination will automatically be set to the pipeline's stream if one exists.
   * If `false` or `undefined`, no dead letter queue is created.
   */
  deadLetterQueue?: boolean | StreamConfig<DeadLetterModel>;

  /**
   * An optional version string applying to all components (table, stream, ingest) created by this pipeline configuration.
   * This version will be used for schema versioning and component identification.
   *
   * @example "v1.0.0", "2023-12", "prod"
   */
  version?: string;

  /**
   * An optional custom path for the ingestion API endpoint.
   * This will be used as the HTTP path for the ingest API if one is created.
   *
   * @example "pipelines/analytics", "data/events"
   */
  path?: string;

  /**
   * Optional metadata for the pipeline.
   */
  metadata?: {
    /** Human-readable description of the pipeline's purpose */
    description?: string;
  };

  /** Determines how changes in code will propagate to the resources. */
  lifeCycle?: LifeCycle;
};

/**
 * Represents a complete ingestion pipeline, potentially combining an Ingest API, a Stream, and an OLAP Table
 * under a single name and configuration. Simplifies the setup of common ingestion patterns.
 *
 * This class provides a high-level abstraction for creating data ingestion workflows that can include:
 * - An HTTP API endpoint for receiving data
 * - A streaming component for real-time data processing
 * - An OLAP table for analytical queries
 *
 * @template T The data type of the records flowing through the pipeline. This type defines the schema for the
 *             Ingest API input, the Stream messages, and the OLAP Table rows.
 *
 * @example
 * ```typescript
 * // Create a complete pipeline with all components
 * const userDataPipeline = new IngestPipeline('userData', {
 *   table: true,
 *   stream: true,
 *   ingestAPI: true,
 *   version: '1.0.0',
 *   metadata: { description: 'Pipeline for user registration data' }
 * });
 *
 * // Create a pipeline with only table and stream
 * const analyticsStream = new IngestPipeline('analytics', {
 *   table: { orderByFields: ['timestamp'], engine: ClickHouseEngines.ReplacingMergeTree },
 *   stream: { parallelism: 8, retentionPeriod: 604800 },
 *   ingestAPI: false
 * });
 * ```
 */
export class IngestPipeline<T> extends TypedBase<T, IngestPipelineConfig<T>> {
  /**
   * The OLAP table component of the pipeline, if configured.
   * Provides analytical query capabilities for the ingested data.
   * Only present when `config.table` is not `false`.
   */
  table?: OlapTable<T>;

  /**
   * The stream component of the pipeline, if configured.
   * Handles real-time data flow and processing between components.
   * Only present when `config.stream` is not `false`.
   */
  stream?: Stream<T>;

  /**
   * The ingest API component of the pipeline, if configured.
   * Provides HTTP endpoints for data ingestion.
   * Only present when `config.ingestAPI` is not `false`.
   */
  ingestApi?: IngestApi<T>;

  /** The dead letter queue of the pipeline, if configured. */
  deadLetterQueue?: DeadLetterQueue<T>;

  /**
   * Creates a new IngestPipeline instance.
   * Based on the configuration, it automatically creates and links the IngestApi, Stream, and OlapTable components.
   *
   * @param name The base name for the pipeline components (e.g., "userData" could create "userData" table, "userData" stream, "userData" ingest API).
   * @param config Optional configuration for the ingestion pipeline.
   *
   * @throws {Error} When ingest API is enabled but no stream is configured, since the API requires a stream destination.
   *
   * @example
   * ```typescript
   * const pipeline = new IngestPipeline('events', {
   *   table: { orderByFields: ['timestamp'], engine: ClickHouseEngines.ReplacingMergeTree },
   *   stream: { parallelism: 2 },
   *   ingestAPI: true
   * });
   * ```
   */
  constructor(name: string, config: IngestPipelineConfig<T>);

  /**
   * Internal constructor used by the framework for advanced initialization.
   *
   * @internal
   * @param name The base name for the pipeline components.
   * @param config Configuration specifying which components to create and their settings.
   * @param schema JSON schema collection for type validation.
   * @param columns Column definitions for the data model.
   */
  constructor(
    name: string,
    config: IngestPipelineConfig<T>,
    schema: IJsonSchemaCollection.IV3_1,
    columns: Column[],
    validators: TypiaValidators<T>,
  );

  constructor(
    name: string,
    config: IngestPipelineConfig<T>,
    schema?: IJsonSchemaCollection.IV3_1,
    columns?: Column[],
    validators?: TypiaValidators<T>,
  ) {
    super(name, config, schema, columns, validators);

    // Handle backwards compatibility for deprecated 'ingest' parameter
    if (config.ingest !== undefined) {
      console.warn(
        "⚠️  DEPRECATION WARNING: The 'ingest' parameter is deprecated and will be removed in a future version. " +
          "Please use 'ingestAPI' instead.",
      );
      // If ingestAPI is not explicitly set, use the ingest value
      if (config.ingestAPI === undefined) {
        (config as any).ingestAPI = config.ingest;
      }
    }

    // Create OLAP table if configured
    if (config.table) {
      const tableConfig: OlapConfig<T> =
        typeof config.table === "object" ?
          {
            ...config.table,
            ...(config.version && { version: config.version }),
          }
        : {
            lifeCycle: config.lifeCycle,
            engine: ClickHouseEngines.MergeTree,
            ...(config.version && { version: config.version }),
          };
      this.table = new OlapTable(
        name,
        tableConfig,
        this.schema,
        this.columnArray,
        this.validators,
      );
    }

    if (config.deadLetterQueue) {
      const streamConfig = {
        destination: undefined,
        ...(typeof config.deadLetterQueue === "object" ?
          config.deadLetterQueue
        : {}),
        ...(config.version && { version: config.version }),
      };
      this.deadLetterQueue = new DeadLetterQueue<T>(
        `${name}DeadLetterQueue`,
        streamConfig,
        validators!.assert!,
      );
    }

    // Create stream if configured, linking it to the table as destination
    if (config.stream) {
      const streamConfig: StreamConfig<T> = {
        destination: this.table,
        defaultDeadLetterQueue: this.deadLetterQueue,
        ...(typeof config.stream === "object" ?
          config.stream
        : { lifeCycle: config.lifeCycle }),
        ...(config.version && { version: config.version }),
      };
      this.stream = new Stream(
        name,
        streamConfig,
        this.schema,
        this.columnArray,
      );
      // Set pipeline parent reference for internal framework use
      (this.stream as any).pipelineParent = this;
    }

    // Create ingest API if configured, requiring a stream as destination
    const shouldCreateIngestAPI =
      config.ingestAPI || (config.ingest && !config.ingestAPI);
    if (shouldCreateIngestAPI) {
      if (!this.stream) {
        throw new Error("Ingest API needs a stream to write to.");
      }

      const ingestConfig = {
        destination: this.stream,
        deadLetterQueue: this.deadLetterQueue,
        ...(typeof (config.ingestAPI || config.ingest) === "object" ?
          ((config.ingestAPI || config.ingest) as object)
        : {}),
        ...(config.version && { version: config.version }),
        ...(config.path && { path: config.path }),
      };
      this.ingestApi = new IngestApi(
        name,
        ingestConfig,
        this.schema,
        this.columnArray,
      );
      // Set pipeline parent reference for internal framework use
      (this.ingestApi as any).pipelineParent = this;
    }
  }
}
