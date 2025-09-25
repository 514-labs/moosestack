import { IJsonSchemaCollection } from "typia";
import { TypedBase, TypiaValidators } from "../typedBase";
import {
  Column,
  isArrayNestedType,
  isNestedType,
} from "../../dataModels/dataModelTypes";
import { ClickHouseEngines } from "../../blocks/helpers";
import { getMooseInternal } from "../internal";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import type { ConfigurationRegistry } from "../../config/runtime";
import { LifeCycle } from "./lifeCycle";
import { IdentifierBrandedString, quoteIdentifier } from "../../sqlHelpers";

/**
 * Represents a failed record during insertion with error details
 */
export interface FailedRecord<T> {
  /** The original record that failed to insert */
  record: T;
  /** The error message describing why the insertion failed */
  error: string;
  /** Optional: The index of this record in the original batch */
  index?: number;
}

/**
 * Result of an insert operation with detailed success/failure information
 */
export interface InsertResult<T> {
  /** Number of records successfully inserted */
  successful: number;
  /** Number of records that failed to insert */
  failed: number;
  /** Total number of records processed */
  total: number;
  /** Detailed information about failed records (if record isolation was used) */
  failedRecords?: FailedRecord<T>[];
}

/**
 * Error handling strategy for insert operations
 */
export type ErrorStrategy =
  | "fail-fast" // Fail immediately on any error (default)
  | "discard" // Discard bad records and continue with good ones
  | "isolate"; // Retry individual records to isolate failures

/**
 * Options for insert operations
 */
export interface InsertOptions {
  /** Maximum number of bad records to tolerate before failing */
  allowErrors?: number;
  /** Maximum ratio of bad records to tolerate (0.0 to 1.0) before failing */
  allowErrorsRatio?: number;
  /** Error handling strategy */
  strategy?: ErrorStrategy;
  /** Whether to enable dead letter queue for failed records (future feature) */
  deadLetterQueue?: boolean;
  /** Whether to validate data against schema before insertion (default: true) */
  validate?: boolean;
  /** Whether to skip validation for individual records during 'isolate' strategy retries (default: false) */
  skipValidationOnRetry?: boolean;
}

/**
 * Validation result for a record with detailed error information
 */
export interface ValidationError {
  /** The original record that failed validation */
  record: any;
  /** Detailed validation error message */
  error: string;
  /** Optional: The index of this record in the original batch */
  index?: number;
  /** The path to the field that failed validation */
  path?: string;
}

/**
 * Result of data validation with success/failure breakdown
 */
export interface ValidationResult<T> {
  /** Records that passed validation */
  valid: T[];
  /** Records that failed validation with detailed error information */
  invalid: ValidationError[];
  /** Total number of records processed */
  total: number;
}

/**
 * S3Queue-specific table settings that can be modified with ALTER TABLE MODIFY SETTING
 * Note: Since ClickHouse 24.7, settings no longer require the 's3queue_' prefix
 */
export interface S3QueueTableSettings {
  /** Processing mode: "ordered" for sequential or "unordered" for parallel processing */
  mode?: "ordered" | "unordered";
  /** What to do with files after processing: 'keep' or 'delete' */
  after_processing?: "keep" | "delete";
  /** ZooKeeper/Keeper path for coordination between replicas */
  keeper_path?: string;
  /** Number of retry attempts for failed files */
  loading_retries?: string;
  /** Number of threads for parallel processing */
  processing_threads_num?: string;
  /** Enable parallel inserts */
  parallel_inserts?: string;
  /** Enable logging to system.s3queue_log table */
  enable_logging_to_queue_log?: string;
  /** Last processed file path (for ordered mode) */
  last_processed_path?: string;
  /** Maximum number of tracked files in ZooKeeper */
  tracked_files_limit?: string;
  /** TTL for tracked files in seconds */
  tracked_file_ttl_sec?: string;
  /** Minimum polling timeout in milliseconds */
  polling_min_timeout_ms?: string;
  /** Maximum polling timeout in milliseconds */
  polling_max_timeout_ms?: string;
  /** Polling backoff in milliseconds */
  polling_backoff_ms?: string;
  /** Minimum cleanup interval in milliseconds */
  cleanup_interval_min_ms?: string;
  /** Maximum cleanup interval in milliseconds */
  cleanup_interval_max_ms?: string;
  /** Number of buckets for sharding (0 = disabled) */
  buckets?: string;
  /** Batch size for listing objects */
  list_objects_batch_size?: string;
  /** Enable hash ring filtering for distributed processing */
  enable_hash_ring_filtering?: string;
  /** Maximum files to process before committing */
  max_processed_files_before_commit?: string;
  /** Maximum rows to process before committing */
  max_processed_rows_before_commit?: string;
  /** Maximum bytes to process before committing */
  max_processed_bytes_before_commit?: string;
  /** Maximum processing time in seconds before committing */
  max_processing_time_sec_before_commit?: string;
  /** Use persistent processing nodes (available from 25.8) */
  use_persistent_processing_nodes?: string;
  /** TTL for persistent processing nodes in seconds */
  persistent_processing_nodes_ttl_seconds?: string;
  /** Additional settings */
  [key: string]: string | undefined;
}

/**
 * Base configuration shared by all table engines
 * @template T The data type of the records stored in the table.
 */
type BaseOlapConfig<T> = {
  /**
   * Specifies the fields to use for ordering data within the ClickHouse table.
   * This is crucial for optimizing query performance.
   */
  orderByFields?: (keyof T & string)[] | ["tuple()"];
  /**
   * Optional PARTITION BY expression (single ClickHouse SQL expression)
   */
  partitionBy?: string;
  /**
   * An optional version string for this configuration.
   */
  version?: string;
  lifeCycle?: LifeCycle;
  /**
   * Optional table-level settings that can be modified with ALTER TABLE MODIFY SETTING.
   * These are alterable settings that can be changed without recreating the table.
   */
  settings?: { [key: string]: string };
};

/**
 * Configuration for MergeTree engine
 * @template T The data type of the records stored in the table.
 */
export type MergeTreeConfig<T> = BaseOlapConfig<T> & {
  engine: ClickHouseEngines.MergeTree;
};

/**
 * Configuration for ReplacingMergeTree engine (deduplication)
 * @template T The data type of the records stored in the table.
 */
export type ReplacingMergeTreeConfig<T> = BaseOlapConfig<T> & {
  engine: ClickHouseEngines.ReplacingMergeTree;
  ver?: keyof T & string; // Optional version column
  isDeleted?: keyof T & string; // Optional is_deleted column
};

/**
 * Configuration for AggregatingMergeTree engine
 * @template T The data type of the records stored in the table.
 */
export type AggregatingMergeTreeConfig<T> = BaseOlapConfig<T> & {
  engine: ClickHouseEngines.AggregatingMergeTree;
};

/**
 * Configuration for SummingMergeTree engine
 * @template T The data type of the records stored in the table.
 */
export type SummingMergeTreeConfig<T> = BaseOlapConfig<T> & {
  engine: ClickHouseEngines.SummingMergeTree;
};

/**
 * Configuration for S3Queue engine - only non-alterable constructor parameters.
 * S3Queue-specific settings like 'mode', 'keeper_path', etc. should be specified
 * in the settings field, not here.
 * @template T The data type of the records stored in the table.
 */
export type S3QueueConfig<T> = Omit<BaseOlapConfig<T>, "settings"> & {
  engine: ClickHouseEngines.S3Queue;
  /** S3 bucket path with wildcards (e.g., 's3://bucket/data/*.json') */
  s3Path: string;
  /** Data format (e.g., 'JSONEachRow', 'CSV', 'Parquet') */
  format: string;
  /** AWS access key ID (optional, omit for NOSIGN/public buckets) */
  awsAccessKeyId?: string;
  /** AWS secret access key */
  awsSecretAccessKey?: string;
  /** Compression type (e.g., 'gzip', 'zstd') */
  compression?: string;
  /** Custom HTTP headers */
  headers?: { [key: string]: string };
  /**
   * S3Queue-specific table settings that can be modified with ALTER TABLE MODIFY SETTING.
   * These settings control the behavior of the S3Queue engine.
   */
  settings?: S3QueueTableSettings;
};

/**
 * Legacy configuration (backward compatibility) - defaults to MergeTree engine
 * @template T The data type of the records stored in the table.
 */
export type LegacyOlapConfig<T> = BaseOlapConfig<T>;

type EngineConfig<T> =
  | MergeTreeConfig<T>
  | ReplacingMergeTreeConfig<T>
  | AggregatingMergeTreeConfig<T>
  | SummingMergeTreeConfig<T>
  | S3QueueConfig<T>;

/**
 * Union of all engine-specific configurations (new API)
 * @template T The data type of the records stored in the table.
 */
export type OlapConfig<T> = EngineConfig<T> | LegacyOlapConfig<T>;

/**
 * Represents an OLAP (Online Analytical Processing) table, typically corresponding to a ClickHouse table.
 * Provides a typed interface for interacting with the table.
 *
 * @template T The data type of the records stored in the table. The structure of T defines the table schema.
 */
export class OlapTable<T> extends TypedBase<T, OlapConfig<T>> {
  name: IdentifierBrandedString;

  /** @internal */
  public readonly kind = "OlapTable";

  /** @internal Memoized ClickHouse client for reusing connections across insert calls */
  private _memoizedClient?: any;
  /** @internal Hash of the configuration used to create the memoized client */
  private _configHash?: string;
  /** @internal Cached table name to avoid repeated generation */
  private _cachedTableName?: string;

  /**
   * Creates a new OlapTable instance.
   * @param name The name of the table. This name is used for the underlying ClickHouse table.
   * @param config Optional configuration for the OLAP table.
   */
  constructor(name: string, config?: OlapConfig<T>);

  /** @internal **/
  constructor(
    name: string,
    config: OlapConfig<T>,
    schema: IJsonSchemaCollection.IV3_1,
    columns: Column[],
    validators?: TypiaValidators<T>,
  );

  constructor(
    name: string,
    config?: OlapConfig<T>,
    schema?: IJsonSchemaCollection.IV3_1,
    columns?: Column[],
    validators?: TypiaValidators<T>,
  ) {
    // Handle legacy configuration by defaulting to MergeTree when no engine is specified
    const resolvedConfig =
      config ?
        "engine" in config ?
          config
        : { ...config, engine: ClickHouseEngines.MergeTree }
      : { engine: ClickHouseEngines.MergeTree };

    super(name, resolvedConfig, schema, columns, validators);
    this.name = name;

    const tables = getMooseInternal().tables;
    if (tables.has(name)) {
      throw new Error(`OlapTable with name ${name} already exists`);
    }
    tables.set(name, this);
  }

  /**
   * Generates the versioned table name following Moose's naming convention
   * Format: {tableName}_{version_with_dots_replaced_by_underscores}
   */
  private generateTableName(): string {
    // Cache the table name since version rarely changes
    if (this._cachedTableName) {
      return this._cachedTableName;
    }

    const tableVersion = this.config.version;
    if (!tableVersion) {
      this._cachedTableName = this.name;
    } else {
      const versionSuffix = tableVersion.replace(/\./g, "_");
      this._cachedTableName = `${this.name}_${versionSuffix}`;
    }

    return this._cachedTableName;
  }

  /**
   * Creates a fast hash of the ClickHouse configuration.
   * Uses crypto.createHash for better performance than JSON.stringify.
   *
   * @private
   */
  private createConfigHash(clickhouseConfig: any): string {
    // Create a deterministic string from config values only
    const configString = `${clickhouseConfig.host}:${clickhouseConfig.port}:${clickhouseConfig.username}:${clickhouseConfig.password}:${clickhouseConfig.database}:${clickhouseConfig.useSSL}`;
    return createHash("sha256")
      .update(configString)
      .digest("hex")
      .substring(0, 16);
  }

  /**
   * Gets or creates a memoized ClickHouse client.
   * The client is cached and reused across multiple insert calls for better performance.
   * If the configuration changes, a new client will be created.
   *
   * @private
   */
  private async getMemoizedClient() {
    await import("../../config/runtime");
    const configRegistry = (globalThis as any)
      ._mooseConfigRegistry as ConfigurationRegistry;
    const { getClickhouseClient } = await import("../../commons");

    // Get configuration from registry (with fallback to file)
    const clickhouseConfig = await configRegistry.getClickHouseConfig();

    // Create a fast hash of the current configuration to detect changes
    const currentConfigHash = this.createConfigHash(clickhouseConfig);

    // If we have a cached client and the config hasn't changed, reuse it
    if (this._memoizedClient && this._configHash === currentConfigHash) {
      return { client: this._memoizedClient, config: clickhouseConfig };
    }

    // Close existing client if config changed
    if (this._memoizedClient && this._configHash !== currentConfigHash) {
      try {
        await this._memoizedClient.close();
      } catch (error) {
        // Ignore errors when closing old client
      }
    }

    // Create new client with standard configuration
    const client = getClickhouseClient({
      username: clickhouseConfig.username,
      password: clickhouseConfig.password,
      database: clickhouseConfig.database,
      useSSL: clickhouseConfig.useSSL ? "true" : "false",
      host: clickhouseConfig.host,
      port: clickhouseConfig.port,
    });

    // Cache the new client and config hash
    this._memoizedClient = client;
    this._configHash = currentConfigHash;

    return { client, config: clickhouseConfig };
  }

  /**
   * Closes the memoized ClickHouse client if it exists.
   * This is useful for cleaning up connections when the table instance is no longer needed.
   * The client will be automatically recreated on the next insert call if needed.
   */
  async closeClient(): Promise<void> {
    if (this._memoizedClient) {
      try {
        await this._memoizedClient.close();
      } catch (error) {
        // Ignore errors when closing
      } finally {
        this._memoizedClient = undefined;
        this._configHash = undefined;
      }
    }
  }

  /**
   * Validates a single record using typia's comprehensive type checking.
   * This provides the most accurate validation as it uses the exact TypeScript type information.
   *
   * @param record The record to validate
   * @returns Validation result with detailed error information
   */
  validateRecord(record: unknown): {
    success: boolean;
    data?: T;
    errors?: string[];
  } {
    // Use injected typia validator if available
    if (this.validators?.validate) {
      try {
        const result = this.validators.validate(record);
        return {
          success: result.success,
          data: result.data,
          errors: result.errors?.map((err) =>
            typeof err === "string" ? err : JSON.stringify(err),
          ),
        };
      } catch (error) {
        return {
          success: false,
          errors: [error instanceof Error ? error.message : String(error)],
        };
      }
    }

    throw new Error("No typia validator found");
  }

  /**
   * Type guard function using typia's is() function.
   * Provides compile-time type narrowing for TypeScript.
   *
   * @param record The record to check
   * @returns True if record matches type T, with type narrowing
   */
  isValidRecord(record: unknown): record is T {
    if (this.validators?.is) {
      return this.validators.is(record);
    }

    throw new Error("No typia validator found");
  }

  /**
   * Assert that a record matches type T, throwing detailed errors if not.
   * Uses typia's assert() function for the most detailed error reporting.
   *
   * @param record The record to assert
   * @returns The validated and typed record
   * @throws Detailed validation error if record doesn't match type T
   */
  assertValidRecord(record: unknown): T {
    if (this.validators?.assert) {
      return this.validators.assert(record);
    }

    throw new Error("No typia validator found");
  }

  /**
   * Validates an array of records with comprehensive error reporting.
   * Uses the most appropriate validation method available (typia or basic).
   *
   * @param data Array of records to validate
   * @returns Detailed validation results
   */
  async validateRecords(data: unknown[]): Promise<ValidationResult<T>> {
    const valid: T[] = [];
    const invalid: ValidationError[] = [];

    // Pre-allocate arrays with estimated sizes to reduce reallocations
    valid.length = 0;
    invalid.length = 0;

    // Use for loop instead of forEach for better performance
    const dataLength = data.length;
    for (let i = 0; i < dataLength; i++) {
      const record = data[i];

      try {
        // Fast path: use typia's is() function first for type checking
        if (this.isValidRecord(record)) {
          valid.push(this.mapToClickhouseRecord(record));
        } else {
          // Only use expensive validateRecord for detailed errors when needed
          const result = this.validateRecord(record);
          if (result.success) {
            valid.push(this.mapToClickhouseRecord(record));
          } else {
            invalid.push({
              record,
              error: result.errors?.join(", ") || "Validation failed",
              index: i,
              path: "root",
            });
          }
        }
      } catch (error) {
        invalid.push({
          record,
          error: error instanceof Error ? error.message : String(error),
          index: i,
          path: "root",
        });
      }
    }

    return {
      valid,
      invalid,
      total: dataLength,
    };
  }

  /**
   * Optimized batch retry that minimizes individual insert operations.
   * Groups records into smaller batches to reduce round trips while still isolating failures.
   *
   * @private
   */
  private async retryIndividualRecords(
    client: any,
    tableName: string,
    records: T[],
  ): Promise<{ successful: T[]; failed: FailedRecord<T>[] }> {
    const successful: T[] = [];
    const failed: FailedRecord<T>[] = [];

    // Instead of individual inserts, try smaller batches first (batches of 10)
    const RETRY_BATCH_SIZE = 10;
    const totalRecords = records.length;

    for (let i = 0; i < totalRecords; i += RETRY_BATCH_SIZE) {
      const batchEnd = Math.min(i + RETRY_BATCH_SIZE, totalRecords);
      const batch = records.slice(i, batchEnd);

      try {
        await client.insert({
          table: quoteIdentifier(tableName),
          values: batch,
          format: "JSONEachRow",
          clickhouse_settings: {
            date_time_input_format: "best_effort",
            // Add performance settings for retries
            max_insert_block_size: RETRY_BATCH_SIZE,
            max_block_size: RETRY_BATCH_SIZE,
          },
        });
        successful.push(...batch);
      } catch (batchError) {
        // If small batch fails, fall back to individual records
        for (let j = 0; j < batch.length; j++) {
          const record = batch[j];
          try {
            await client.insert({
              table: quoteIdentifier(tableName),
              values: [record],
              format: "JSONEachRow",
              clickhouse_settings: {
                date_time_input_format: "best_effort",
              },
            });
            successful.push(record);
          } catch (error) {
            failed.push({
              record,
              error: error instanceof Error ? error.message : String(error),
              index: i + j,
            });
          }
        }
      }
    }

    return { successful, failed };
  }

  /**
   * Validates input parameters and strategy compatibility
   * @private
   */
  private validateInsertParameters(
    data: T[] | Readable,
    options?: InsertOptions,
  ): { isStream: boolean; strategy: string; shouldValidate: boolean } {
    const isStream = data instanceof Readable;
    const strategy = options?.strategy || "fail-fast";
    const shouldValidate = options?.validate !== false;

    // Validate strategy compatibility with streams
    if (isStream && strategy === "isolate") {
      throw new Error(
        "The 'isolate' error strategy is not supported with stream input. Use 'fail-fast' or 'discard' instead.",
      );
    }

    // Validate that validation is not attempted on streams
    if (isStream && shouldValidate) {
      console.warn(
        "Validation is not supported with stream input. Validation will be skipped.",
      );
    }

    return { isStream, strategy, shouldValidate };
  }

  /**
   * Handles early return cases for empty data
   * @private
   */
  private handleEmptyData(
    data: T[] | Readable,
    isStream: boolean,
  ): InsertResult<T> | null {
    if (isStream && !data) {
      return {
        successful: 0,
        failed: 0,
        total: 0,
      };
    }

    if (!isStream && (!data || (data as T[]).length === 0)) {
      return {
        successful: 0,
        failed: 0,
        total: 0,
      };
    }

    return null;
  }

  /**
   * Performs pre-insertion validation for array data
   * @private
   */
  private async performPreInsertionValidation(
    data: T[],
    shouldValidate: boolean,
    strategy: string,
    options?: InsertOptions,
  ): Promise<{ validatedData: T[]; validationErrors: ValidationError[] }> {
    if (!shouldValidate) {
      return { validatedData: data, validationErrors: [] };
    }

    try {
      const validationResult = await this.validateRecords(data as unknown[]);
      const validatedData = validationResult.valid;
      const validationErrors = validationResult.invalid;

      if (validationErrors.length > 0) {
        this.handleValidationErrors(validationErrors, strategy, data, options);

        // Return appropriate data based on strategy
        switch (strategy) {
          case "discard":
            return { validatedData, validationErrors };
          case "isolate":
            return { validatedData: data, validationErrors };
          default:
            return { validatedData, validationErrors };
        }
      }

      return { validatedData, validationErrors };
    } catch (validationError) {
      if (strategy === "fail-fast") {
        throw validationError;
      }
      console.warn("Validation error:", validationError);
      return { validatedData: data, validationErrors: [] };
    }
  }

  /**
   * Handles validation errors based on the specified strategy
   * @private
   */
  private handleValidationErrors(
    validationErrors: ValidationError[],
    strategy: string,
    data: T[],
    options?: InsertOptions,
  ): void {
    switch (strategy) {
      case "fail-fast":
        const firstError = validationErrors[0];
        throw new Error(
          `Validation failed for record at index ${firstError.index}: ${firstError.error}`,
        );

      case "discard":
        this.checkValidationThresholds(validationErrors, data.length, options);
        break;

      case "isolate":
        // For isolate strategy, validation errors will be handled in the final result
        break;
    }
  }

  /**
   * Checks if validation errors exceed configured thresholds
   * @private
   */
  private checkValidationThresholds(
    validationErrors: ValidationError[],
    totalRecords: number,
    options?: InsertOptions,
  ): void {
    const validationFailedCount = validationErrors.length;
    const validationFailedRatio = validationFailedCount / totalRecords;

    if (
      options?.allowErrors !== undefined &&
      validationFailedCount > options.allowErrors
    ) {
      throw new Error(
        `Too many validation failures: ${validationFailedCount} > ${options.allowErrors}. Errors: ${validationErrors.map((e) => e.error).join(", ")}`,
      );
    }

    if (
      options?.allowErrorsRatio !== undefined &&
      validationFailedRatio > options.allowErrorsRatio
    ) {
      throw new Error(
        `Validation failure ratio too high: ${validationFailedRatio.toFixed(3)} > ${options.allowErrorsRatio}. Errors: ${validationErrors.map((e) => e.error).join(", ")}`,
      );
    }
  }

  /**
   * Optimized insert options preparation with better memory management
   * @private
   */
  private prepareInsertOptions(
    tableName: string,
    data: T[] | Readable,
    validatedData: T[],
    isStream: boolean,
    strategy: string,
    options?: InsertOptions,
  ): any {
    const insertOptions: any = {
      table: quoteIdentifier(tableName),
      format: "JSONEachRow",
      clickhouse_settings: {
        date_time_input_format: "best_effort",
        wait_end_of_query: 1, // Ensure at least once delivery for INSERT operations
        // Performance optimizations
        max_insert_block_size:
          isStream ? 100000 : Math.min(validatedData.length, 100000),
        max_block_size: 65536,
        // Use async inserts for better performance with large datasets
        async_insert: validatedData.length > 1000 ? 1 : 0,
        wait_for_async_insert: 1, // For at least once delivery
      },
    };

    // Handle stream vs array input
    if (isStream) {
      insertOptions.values = data;
    } else {
      insertOptions.values = validatedData;
    }

    // For discard strategy, add optimized ClickHouse error tolerance settings
    if (
      strategy === "discard" &&
      (options?.allowErrors !== undefined ||
        options?.allowErrorsRatio !== undefined)
    ) {
      if (options.allowErrors !== undefined) {
        insertOptions.clickhouse_settings.input_format_allow_errors_num =
          options.allowErrors;
      }

      if (options.allowErrorsRatio !== undefined) {
        insertOptions.clickhouse_settings.input_format_allow_errors_ratio =
          options.allowErrorsRatio;
      }
    }

    return insertOptions;
  }

  /**
   * Creates success result for completed insertions
   * @private
   */
  private createSuccessResult(
    data: T[] | Readable,
    validatedData: T[],
    validationErrors: ValidationError[],
    isStream: boolean,
    shouldValidate: boolean,
    strategy: string,
  ): InsertResult<T> {
    if (isStream) {
      return {
        successful: -1, // -1 indicates stream mode where count is unknown
        failed: 0,
        total: -1,
      };
    }

    const insertedCount = validatedData.length;
    const totalProcessed =
      shouldValidate ? (data as T[]).length : insertedCount;

    const result: InsertResult<T> = {
      successful: insertedCount,
      failed: shouldValidate ? validationErrors.length : 0,
      total: totalProcessed,
    };

    // Add failed records if there are validation errors and using discard strategy
    if (
      shouldValidate &&
      validationErrors.length > 0 &&
      strategy === "discard"
    ) {
      result.failedRecords = validationErrors.map((ve) => ({
        record: ve.record as T,
        error: `Validation error: ${ve.error}`,
        index: ve.index,
      }));
    }

    return result;
  }

  /**
   * Handles insertion errors based on the specified strategy
   * @private
   */
  private async handleInsertionError(
    batchError: any,
    strategy: string,
    tableName: string,
    data: T[] | Readable,
    validatedData: T[],
    validationErrors: ValidationError[],
    isStream: boolean,
    shouldValidate: boolean,
    options?: InsertOptions,
  ): Promise<InsertResult<T>> {
    switch (strategy) {
      case "fail-fast":
        throw new Error(
          `Failed to insert data into table ${tableName}: ${batchError}`,
        );

      case "discard":
        throw new Error(
          `Too many errors during insert into table ${tableName}. Error threshold exceeded: ${batchError}`,
        );

      case "isolate":
        return await this.handleIsolateStrategy(
          batchError,
          tableName,
          data,
          validatedData,
          validationErrors,
          isStream,
          shouldValidate,
          options,
        );

      default:
        throw new Error(`Unknown error strategy: ${strategy}`);
    }
  }

  /**
   * Handles the isolate strategy for insertion errors
   * @private
   */
  private async handleIsolateStrategy(
    batchError: any,
    tableName: string,
    data: T[] | Readable,
    validatedData: T[],
    validationErrors: ValidationError[],
    isStream: boolean,
    shouldValidate: boolean,
    options?: InsertOptions,
  ): Promise<InsertResult<T>> {
    if (isStream) {
      throw new Error(
        `Isolate strategy is not supported with stream input: ${batchError}`,
      );
    }

    try {
      const { client } = await this.getMemoizedClient();
      const skipValidationOnRetry = options?.skipValidationOnRetry || false;
      const retryData = skipValidationOnRetry ? (data as T[]) : validatedData;

      const { successful, failed } = await this.retryIndividualRecords(
        client,
        tableName,
        retryData,
      );

      // Combine validation errors with insertion errors
      const allFailedRecords: FailedRecord<T>[] = [
        // Validation errors (if any and not skipping validation on retry)
        ...(shouldValidate && !skipValidationOnRetry ?
          validationErrors.map((ve) => ({
            record: ve.record as T,
            error: `Validation error: ${ve.error}`,
            index: ve.index,
          }))
        : []),
        // Insertion errors
        ...failed,
      ];

      this.checkInsertionThresholds(
        allFailedRecords,
        (data as T[]).length,
        options,
      );

      return {
        successful: successful.length,
        failed: allFailedRecords.length,
        total: (data as T[]).length,
        failedRecords: allFailedRecords,
      };
    } catch (isolationError) {
      throw new Error(
        `Failed to insert data into table ${tableName} during record isolation: ${isolationError}`,
      );
    }
  }

  /**
   * Checks if insertion errors exceed configured thresholds
   * @private
   */
  private checkInsertionThresholds(
    failedRecords: FailedRecord<T>[],
    totalRecords: number,
    options?: InsertOptions,
  ): void {
    const totalFailed = failedRecords.length;
    const failedRatio = totalFailed / totalRecords;

    if (
      options?.allowErrors !== undefined &&
      totalFailed > options.allowErrors
    ) {
      throw new Error(
        `Too many failed records: ${totalFailed} > ${options.allowErrors}. Failed records: ${failedRecords.map((f) => f.error).join(", ")}`,
      );
    }

    if (
      options?.allowErrorsRatio !== undefined &&
      failedRatio > options.allowErrorsRatio
    ) {
      throw new Error(
        `Failed record ratio too high: ${failedRatio.toFixed(3)} > ${options.allowErrorsRatio}. Failed records: ${failedRecords.map((f) => f.error).join(", ")}`,
      );
    }
  }

  /**
   * Recursively transforms a record to match ClickHouse's JSONEachRow requirements
   *
   * - For every Array(Nested(...)) field at any depth, each item is wrapped in its own array and recursively processed.
   * - For every Nested struct (not array), it recurses into the struct.
   * - This ensures compatibility with kafka_clickhouse_sync
   *
   * @param record The input record to transform (may be deeply nested)
   * @param columns The schema columns for this level (defaults to this.columnArray at the top level)
   * @returns The transformed record, ready for ClickHouse JSONEachRow insertion
   */
  private mapToClickhouseRecord(
    record: any,
    columns: Column[] = this.columnArray,
  ): any {
    const result = { ...record };
    for (const col of columns) {
      const value = record[col.name];
      const dt = col.data_type;

      if (isArrayNestedType(dt)) {
        // For Array(Nested(...)), wrap each item in its own array and recurse
        if (
          Array.isArray(value) &&
          (value.length === 0 || typeof value[0] === "object")
        ) {
          result[col.name] = value.map((item) => [
            this.mapToClickhouseRecord(item, dt.elementType.columns),
          ]);
        }
      } else if (isNestedType(dt)) {
        // For Nested struct (not array), recurse into it
        if (value && typeof value === "object") {
          result[col.name] = this.mapToClickhouseRecord(value, dt.columns);
        }
      }
      // All other types: leave as is for now
    }
    return result;
  }

  /**
   * Inserts data directly into the ClickHouse table with enhanced error handling and validation.
   * This method establishes a direct connection to ClickHouse using the project configuration
   * and inserts the provided data into the versioned table.
   *
   * PERFORMANCE OPTIMIZATIONS:
   * - Memoized client connections with fast config hashing
   * - Single-pass validation with pre-allocated arrays
   * - Batch-optimized retry strategy (batches of 10, then individual)
   * - Optimized ClickHouse settings for large datasets
   * - Reduced memory allocations and object creation
   *
   * Uses advanced typia validation when available for comprehensive type checking,
   * with fallback to basic validation for compatibility.
   *
   * The ClickHouse client is memoized and reused across multiple insert calls for better performance.
   * If the configuration changes, a new client will be automatically created.
   *
   * @param data Array of objects conforming to the table schema, or a Node.js Readable stream
   * @param options Optional configuration for error handling, validation, and insertion behavior
   * @returns Promise resolving to detailed insertion results
   * @throws {ConfigError} When configuration cannot be read or parsed
   * @throws {ClickHouseError} When insertion fails based on the error strategy
   * @throws {ValidationError} When validation fails and strategy is 'fail-fast'
   *
   * @example
   * ```typescript
   * // Create an OlapTable instance (typia validators auto-injected)
   * const userTable = new OlapTable<User>('users');
   *
   * // Insert with comprehensive typia validation
   * const result1 = await userTable.insert([
   *   { id: 1, name: 'John', email: 'john@example.com' },
   *   { id: 2, name: 'Jane', email: 'jane@example.com' }
   * ]);
   *
   * // Insert data with stream input (validation not available for streams)
   * const dataStream = new Readable({
   *   objectMode: true,
   *   read() { // Stream implementation }
   * });
   * const result2 = await userTable.insert(dataStream, { strategy: 'fail-fast' });
   *
   * // Insert with validation disabled for performance
   * const result3 = await userTable.insert(data, { validate: false });
   *
   * // Insert with error handling strategies
   * const result4 = await userTable.insert(mixedData, {
   *   strategy: 'isolate',
   *   allowErrorsRatio: 0.1,
   *   validate: true  // Use typia validation (default)
   * });
   *
   * // Optional: Clean up connection when completely done
   * await userTable.closeClient();
   * ```
   */
  async insert(
    data: T[] | Readable,
    options?: InsertOptions,
  ): Promise<InsertResult<T>> {
    // Validate input parameters and strategy compatibility
    const { isStream, strategy, shouldValidate } =
      this.validateInsertParameters(data, options);

    // Handle early return cases for empty data
    const emptyResult = this.handleEmptyData(data, isStream);
    if (emptyResult) {
      return emptyResult;
    }

    // Pre-insertion validation for arrays (optimized single-pass)
    let validatedData: T[] = [];
    let validationErrors: ValidationError[] = [];

    if (!isStream && shouldValidate) {
      const validationResult = await this.performPreInsertionValidation(
        data as T[],
        shouldValidate,
        strategy,
        options,
      );
      validatedData = validationResult.validatedData;
      validationErrors = validationResult.validationErrors;
    } else {
      // No validation or stream input
      validatedData = isStream ? [] : (data as T[]);
    }

    // Get memoized client and generate cached table name
    const { client } = await this.getMemoizedClient();
    const tableName = this.generateTableName();

    try {
      // Prepare and execute insertion with optimized settings
      const insertOptions = this.prepareInsertOptions(
        tableName,
        data,
        validatedData,
        isStream,
        strategy,
        options,
      );

      await client.insert(insertOptions);

      // Return success result
      return this.createSuccessResult(
        data,
        validatedData,
        validationErrors,
        isStream,
        shouldValidate,
        strategy,
      );
    } catch (batchError) {
      // Handle insertion failure based on strategy with optimized retry
      return await this.handleInsertionError(
        batchError,
        strategy,
        tableName,
        data,
        validatedData,
        validationErrors,
        isStream,
        shouldValidate,
        options,
      );
    }
    // Note: We don't close the client here since it's memoized for reuse
    // Use closeClient() method if you need to explicitly close the connection
  }

  // Note: Static factory methods (withS3Queue, withReplacingMergeTree, withMergeTree)
  // were removed in ENG-856. Use direct configuration instead, e.g.:
  // new OlapTable(name, { engine: ClickHouseEngines.ReplacingMergeTree, orderByFields: ["id"], ver: "updated_at" })
}
