/**
 * @module internal
 * Internal implementation details for the Moose v2 data model (dmv2).
 *
 * This module manages the registration of user-defined dmv2 resources (Tables, Streams, APIs, etc.)
 * and provides functions to serialize these resources into a JSON format (`InfrastructureMap`)
 * expected by the Moose infrastructure management system. It also includes helper functions
 * to retrieve registered handler functions (for streams and APIs) and the base class
 * (`TypedBase`) used by dmv2 resource classes.
 *
 * @internal This module is intended for internal use by the Moose library and compiler plugin.
 *           Its API might change without notice.
 */
import process from "process";
import { Api, IngestApi, SqlResource, Task, Workflow } from "./index";
import { IJsonSchemaCollection } from "typia/src/schemas/json/IJsonSchemaCollection";
import { Column } from "../dataModels/dataModelTypes";
import { ClickHouseEngines, ApiUtil } from "../index";
import {
  OlapTable,
  OlapConfig,
  ReplacingMergeTreeConfig,
  SummingMergeTreeConfig,
  ReplicatedMergeTreeConfig,
  ReplicatedReplacingMergeTreeConfig,
  ReplicatedAggregatingMergeTreeConfig,
  ReplicatedSummingMergeTreeConfig,
  S3QueueConfig,
} from "./sdk/olapTable";
import {
  ConsumerConfig,
  KafkaSchemaConfig,
  Stream,
  TransformConfig,
} from "./sdk/stream";
import { compilerLog } from "../commons";
import { WebApp } from "./sdk/webApp";

/**
 * Gets the source directory from environment variable or defaults to "app"
 */
function getSourceDir(): string {
  return process.env.MOOSE_SOURCE_DIR || "app";
}

/**
 * Internal registry holding all defined Moose dmv2 resources.
 * Populated by the constructors of OlapTable, Stream, IngestApi, etc.
 * Accessed via `getMooseInternal()`.
 */
const moose_internal = {
  tables: new Map<string, OlapTable<any>>(),
  streams: new Map<string, Stream<any>>(),
  ingestApis: new Map<string, IngestApi<any>>(),
  apis: new Map<string, Api<any>>(),
  sqlResources: new Map<string, SqlResource>(),
  workflows: new Map<string, Workflow>(),
  webApps: new Map<string, WebApp>(),
};
/**
 * Default retention period for streams if not specified (7 days in seconds).
 */
const defaultRetentionPeriod = 60 * 60 * 24 * 7;

/**
 * Engine-specific configuration types using discriminated union pattern
 */
interface MergeTreeEngineConfig {
  engine: "MergeTree";
}

interface ReplacingMergeTreeEngineConfig {
  engine: "ReplacingMergeTree";
  ver?: string;
  isDeleted?: string;
}

interface AggregatingMergeTreeEngineConfig {
  engine: "AggregatingMergeTree";
}

interface SummingMergeTreeEngineConfig {
  engine: "SummingMergeTree";
  columns?: string[];
}

interface ReplicatedMergeTreeEngineConfig {
  engine: "ReplicatedMergeTree";
  keeperPath?: string;
  replicaName?: string;
}

interface ReplicatedReplacingMergeTreeEngineConfig {
  engine: "ReplicatedReplacingMergeTree";
  keeperPath?: string;
  replicaName?: string;
  ver?: string;
  isDeleted?: string;
}

interface ReplicatedAggregatingMergeTreeEngineConfig {
  engine: "ReplicatedAggregatingMergeTree";
  keeperPath?: string;
  replicaName?: string;
}

interface ReplicatedSummingMergeTreeEngineConfig {
  engine: "ReplicatedSummingMergeTree";
  keeperPath?: string;
  replicaName?: string;
  columns?: string[];
}

interface S3QueueEngineConfig {
  engine: "S3Queue";
  s3Path: string;
  format: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  compression?: string;
  headers?: { [key: string]: string };
}

interface S3EngineConfig {
  engine: "S3";
  path: string;
  format: string;
  noSign?: boolean;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  compression?: string;
  partitionStrategy?: string;
  partitionColumnsInDataFile?: string;
}

interface BufferEngineConfig {
  engine: "Buffer";
  targetDatabase: string;
  targetTable: string;
  numLayers: number;
  minTime: number;
  maxTime: number;
  minRows: number;
  maxRows: number;
  minBytes: number;
  maxBytes: number;
  flushTime?: number;
  flushRows?: number;
  flushBytes?: number;
}

interface DistributedEngineConfig {
  engine: "Distributed";
  cluster: string;
  targetDatabase: string;
  targetTable: string;
  shardingKey?: string;
  policyName?: string;
}

/**
 * Union type for all supported engine configurations
 */
type EngineConfig =
  | MergeTreeEngineConfig
  | ReplacingMergeTreeEngineConfig
  | AggregatingMergeTreeEngineConfig
  | SummingMergeTreeEngineConfig
  | ReplicatedMergeTreeEngineConfig
  | ReplicatedReplacingMergeTreeEngineConfig
  | ReplicatedAggregatingMergeTreeEngineConfig
  | ReplicatedSummingMergeTreeEngineConfig
  | S3QueueEngineConfig
  | S3EngineConfig
  | BufferEngineConfig
  | DistributedEngineConfig;

/**
 * JSON representation of an OLAP table configuration.
 */
interface TableJson {
  /** The name of the table. */
  name: string;
  /** Array defining the table's columns and their types. */
  columns: Column[];
  /** ORDER BY clause: either array of column names or a single ClickHouse expression. */
  orderBy: string[] | string;
  /** The column name used for the PARTITION BY clause. */
  partitionBy?: string;
  /** SAMPLE BY expression for approximate query processing. */
  sampleByExpression?: string;
  /** Engine configuration with type-safe, engine-specific parameters */
  engineConfig?: EngineConfig;
  /** Optional version string for the table configuration. */
  version?: string;
  /** Optional metadata for the table (e.g., description). */
  metadata?: { description?: string };
  /** Lifecycle management setting for the table. */
  lifeCycle?: string;
  /** Optional table-level settings that can be modified with ALTER TABLE MODIFY SETTING. */
  tableSettings?: { [key: string]: string };
  /** Optional table indexes */
  indexes?: {
    name: string;
    expression: string;
    type: string;
    arguments: string[];
    granularity: number;
  }[];
  /** Optional table-level TTL expression (without leading 'TTL'). */
  ttl?: string;
  /** Optional database name for multi-database support. */
  database?: string;
}
/**
 * Represents a target destination for data flow, typically a stream.
 */
interface Target {
  /** The name of the target resource (e.g., stream name). */
  name: string;
  /** The kind of the target resource. */
  kind: "stream"; // may add `| "table"` in the future
  /** Optional version string of the target resource's configuration. */
  version?: string;
  /** Optional metadata for the target (e.g., description for function processes). */
  metadata?: { description?: string };
}

/**
 * Represents a consumer attached to a stream.
 */
interface Consumer {
  /** Optional version string for the consumer configuration. */
  version?: string;
}

/**
 * JSON representation of a Stream/Topic configuration.
 */
interface StreamJson {
  /** The name of the stream/topic. */
  name: string;
  /** Array defining the message schema (columns/fields). */
  columns: Column[];
  /** Data retention period in seconds. */
  retentionPeriod: number;
  /** Number of partitions for the stream/topic. */
  partitionCount: number;
  /** Optional name of the OLAP table this stream automatically syncs to. */
  targetTable?: string;
  /** Optional version of the target OLAP table configuration. */
  targetTableVersion?: string;
  /** Optional version string for the stream configuration. */
  version?: string;
  /** List of target streams this stream transforms data into. */
  transformationTargets: Target[];
  /** Flag indicating if a multi-transform function (`_multipleTransformations`) is defined. */
  hasMultiTransform: boolean;
  /** List of consumers attached to this stream. */
  consumers: Consumer[];
  /** Optional description for the stream. */
  metadata?: { description?: string };
  /** Lifecycle management setting for the stream. */
  lifeCycle?: string;
  /** Optional Schema Registry config */
  schemaConfig?: KafkaSchemaConfig;
}
/**
 * JSON representation of an Ingest API configuration.
 */
interface IngestApiJson {
  /** The name of the Ingest API endpoint. */
  name: string;
  /** Array defining the expected input schema (columns/fields). */
  columns: Column[];

  /** The target stream where ingested data is written. */
  writeTo: Target;
  /** The DLQ if the data does not fit the schema. */
  deadLetterQueue?: string;
  /** Optional version string for the API configuration. */
  version?: string;
  /** Optional custom path for the ingestion endpoint. */
  path?: string;
  /** Optional description for the API. */
  metadata?: { description?: string };
  /** JSON schema */
  schema: IJsonSchemaCollection.IV3_1;
}

/**
 * JSON representation of an API configuration.
 */
interface ApiJson {
  /** The name of the API endpoint. */
  name: string;
  /** Array defining the expected query parameters schema. */
  queryParams: Column[];
  /** JSON schema definition of the API's response body. */
  responseSchema: IJsonSchemaCollection.IV3_1;
  /** Optional version string for the API configuration. */
  version?: string;
  /** Optional custom path for the API endpoint. */
  path?: string;
  /** Optional description for the API. */
  metadata?: { description?: string };
}

/**
 * Represents the unique signature of an infrastructure component (Table, Topic, etc.).
 * Used for defining dependencies between SQL resources.
 */
interface InfrastructureSignatureJson {
  /** A unique identifier for the resource instance (often name + version). */
  id: string;
  /** The kind/type of the infrastructure component. */
  kind:
    | "Table"
    | "Topic"
    | "ApiEndpoint"
    | "TopicToTableSyncProcess"
    | "View"
    | "SqlResource";
}

interface WorkflowJson {
  name: string;
  retries?: number;
  timeout?: string;
  schedule?: string;
}

interface WebAppJson {
  name: string;
  mountPath: string;
  metadata?: { description?: string };
}

interface SqlResourceJson {
  /** The name of the SQL resource. */
  name: string;
  /** Array of SQL DDL statements required to create the resource. */
  setup: readonly string[];
  /** Array of SQL DDL statements required to drop the resource. */
  teardown: readonly string[];

  /** List of infrastructure components (by signature) that this resource reads from. */
  pullsDataFrom: InfrastructureSignatureJson[];
  /** List of infrastructure components (by signature) that this resource writes to. */
  pushesDataTo: InfrastructureSignatureJson[];
}

/**
 * Type guard: Check if config is S3QueueConfig
 */
function isS3QueueConfig(
  config: OlapConfig<any>,
): config is S3QueueConfig<any> {
  return "engine" in config && config.engine === ClickHouseEngines.S3Queue;
}

/**
 * Type guard: Check if config has a replicated engine
 * Checks if the engine value is one of the replicated engine types
 */
function hasReplicatedEngine(
  config: OlapConfig<any>,
): config is
  | ReplicatedMergeTreeConfig<any>
  | ReplicatedReplacingMergeTreeConfig<any>
  | ReplicatedAggregatingMergeTreeConfig<any>
  | ReplicatedSummingMergeTreeConfig<any> {
  if (!("engine" in config)) {
    return false;
  }

  const engine = config.engine as ClickHouseEngines;
  // Check if engine is one of the replicated engine types
  return (
    engine === ClickHouseEngines.ReplicatedMergeTree ||
    engine === ClickHouseEngines.ReplicatedReplacingMergeTree ||
    engine === ClickHouseEngines.ReplicatedAggregatingMergeTree ||
    engine === ClickHouseEngines.ReplicatedSummingMergeTree
  );
}

/**
 * Extract engine value from table config, handling both legacy and new formats
 */
function extractEngineValue(config: OlapConfig<any>): ClickHouseEngines {
  // Legacy config without engine property defaults to MergeTree
  if (!("engine" in config)) {
    return ClickHouseEngines.MergeTree;
  }

  // All engines (replicated and non-replicated) have engine as direct value
  return config.engine as ClickHouseEngines;
}

/**
 * Convert engine config for basic MergeTree engines
 */
function convertBasicEngineConfig(
  engine: ClickHouseEngines,
  config: OlapConfig<any>,
): EngineConfig | undefined {
  switch (engine) {
    case ClickHouseEngines.MergeTree:
      return { engine: "MergeTree" };

    case ClickHouseEngines.AggregatingMergeTree:
      return { engine: "AggregatingMergeTree" };

    case ClickHouseEngines.ReplacingMergeTree: {
      const replacingConfig = config as ReplacingMergeTreeConfig<any>;
      return {
        engine: "ReplacingMergeTree",
        ver: replacingConfig.ver,
        isDeleted: replacingConfig.isDeleted,
      };
    }

    case ClickHouseEngines.SummingMergeTree: {
      const summingConfig = config as SummingMergeTreeConfig<any>;
      return {
        engine: "SummingMergeTree",
        columns: summingConfig.columns,
      };
    }

    default:
      return undefined;
  }
}

/**
 * Convert engine config for replicated MergeTree engines
 */
function convertReplicatedEngineConfig(
  engine: ClickHouseEngines,
  config: OlapConfig<any>,
): EngineConfig | undefined {
  // First check if this is a replicated engine config
  if (!hasReplicatedEngine(config)) {
    return undefined;
  }

  switch (engine) {
    case ClickHouseEngines.ReplicatedMergeTree: {
      const replicatedConfig = config as ReplicatedMergeTreeConfig<any>;
      return {
        engine: "ReplicatedMergeTree",
        keeperPath: replicatedConfig.keeperPath,
        replicaName: replicatedConfig.replicaName,
      };
    }

    case ClickHouseEngines.ReplicatedReplacingMergeTree: {
      const replicatedConfig =
        config as ReplicatedReplacingMergeTreeConfig<any>;
      return {
        engine: "ReplicatedReplacingMergeTree",
        keeperPath: replicatedConfig.keeperPath,
        replicaName: replicatedConfig.replicaName,
        ver: replicatedConfig.ver,
        isDeleted: replicatedConfig.isDeleted,
      };
    }

    case ClickHouseEngines.ReplicatedAggregatingMergeTree: {
      const replicatedConfig =
        config as ReplicatedAggregatingMergeTreeConfig<any>;
      return {
        engine: "ReplicatedAggregatingMergeTree",
        keeperPath: replicatedConfig.keeperPath,
        replicaName: replicatedConfig.replicaName,
      };
    }

    case ClickHouseEngines.ReplicatedSummingMergeTree: {
      const replicatedConfig = config as ReplicatedSummingMergeTreeConfig<any>;
      return {
        engine: "ReplicatedSummingMergeTree",
        keeperPath: replicatedConfig.keeperPath,
        replicaName: replicatedConfig.replicaName,
        columns: replicatedConfig.columns,
      };
    }

    default:
      return undefined;
  }
}

/**
 * Convert S3Queue engine config
 * Uses type guard for fully type-safe property access
 */
function convertS3QueueEngineConfig(
  config: OlapConfig<any>,
): EngineConfig | undefined {
  if (!isS3QueueConfig(config)) {
    return undefined;
  }

  return {
    engine: "S3Queue",
    s3Path: config.s3Path,
    format: config.format,
    awsAccessKeyId: config.awsAccessKeyId,
    awsSecretAccessKey: config.awsSecretAccessKey,
    compression: config.compression,
    headers: config.headers,
  };
}

/**
 * Convert S3 engine config
 */
function convertS3EngineConfig(
  config: OlapConfig<any>,
): EngineConfig | undefined {
  if (!("engine" in config) || config.engine !== ClickHouseEngines.S3) {
    return undefined;
  }

  const s3Config = config as any;
  return {
    engine: "S3",
    path: s3Config.path,
    format: s3Config.format,
    noSign: s3Config.noSign,
    awsAccessKeyId: s3Config.awsAccessKeyId,
    awsSecretAccessKey: s3Config.awsSecretAccessKey,
    compression: s3Config.compression,
    partitionStrategy: s3Config.partitionStrategy,
    partitionColumnsInDataFile: s3Config.partitionColumnsInDataFile,
  };
}

/**
 * Convert Buffer engine config
 */
function convertBufferEngineConfig(
  config: OlapConfig<any>,
): EngineConfig | undefined {
  if (!("engine" in config) || config.engine !== ClickHouseEngines.Buffer) {
    return undefined;
  }

  const bufferConfig = config as any;
  return {
    engine: "Buffer",
    targetDatabase: bufferConfig.targetDatabase,
    targetTable: bufferConfig.targetTable,
    numLayers: bufferConfig.numLayers,
    minTime: bufferConfig.minTime,
    maxTime: bufferConfig.maxTime,
    minRows: bufferConfig.minRows,
    maxRows: bufferConfig.maxRows,
    minBytes: bufferConfig.minBytes,
    maxBytes: bufferConfig.maxBytes,
    flushTime: bufferConfig.flushTime,
    flushRows: bufferConfig.flushRows,
    flushBytes: bufferConfig.flushBytes,
  };
}

/**
 * Convert Distributed engine config
 */
function convertDistributedEngineConfig(
  config: OlapConfig<any>,
): EngineConfig | undefined {
  if (
    !("engine" in config) ||
    config.engine !== ClickHouseEngines.Distributed
  ) {
    return undefined;
  }

  const distConfig = config as any;
  return {
    engine: "Distributed",
    cluster: distConfig.cluster,
    targetDatabase: distConfig.targetDatabase,
    targetTable: distConfig.targetTable,
    shardingKey: distConfig.shardingKey,
    policyName: distConfig.policyName,
  };
}

/**
 * Convert table configuration to engine config
 */
function convertTableConfigToEngineConfig(
  config: OlapConfig<any>,
): EngineConfig | undefined {
  const engine = extractEngineValue(config);

  // Try basic engines first
  const basicConfig = convertBasicEngineConfig(engine, config);
  if (basicConfig) {
    return basicConfig;
  }

  // Try replicated engines
  const replicatedConfig = convertReplicatedEngineConfig(engine, config);
  if (replicatedConfig) {
    return replicatedConfig;
  }

  // Handle S3Queue
  if (engine === ClickHouseEngines.S3Queue) {
    return convertS3QueueEngineConfig(config);
  }

  // Handle S3
  if (engine === ClickHouseEngines.S3) {
    return convertS3EngineConfig(config);
  }

  // Handle Buffer
  if (engine === ClickHouseEngines.Buffer) {
    return convertBufferEngineConfig(config);
  }

  // Handle Distributed
  if (engine === ClickHouseEngines.Distributed) {
    return convertDistributedEngineConfig(config);
  }

  return undefined;
}

export const toInfraMap = (registry: typeof moose_internal) => {
  const tables: { [key: string]: TableJson } = {};
  const topics: { [key: string]: StreamJson } = {};
  const ingestApis: { [key: string]: IngestApiJson } = {};
  const apis: { [key: string]: ApiJson } = {};
  const sqlResources: { [key: string]: SqlResourceJson } = {};
  const workflows: { [key: string]: WorkflowJson } = {};
  const webApps: { [key: string]: WebAppJson } = {};

  registry.tables.forEach((table) => {
    const id =
      table.config.version ?
        `${table.name}_${table.config.version}`
      : table.name;
    // If the table is part of an IngestPipeline, inherit metadata if not set
    let metadata = (table as any).metadata;
    if (!metadata && table.config && (table as any).pipelineParent) {
      metadata = (table as any).pipelineParent.metadata;
    }
    // Create type-safe engine configuration
    const engineConfig: EngineConfig | undefined =
      convertTableConfigToEngineConfig(table.config);

    // Get table settings, applying defaults for S3Queue
    let tableSettings: { [key: string]: string } | undefined = undefined;

    if (table.config.settings) {
      // Convert all settings to strings, filtering out undefined values
      tableSettings = Object.entries(table.config.settings).reduce(
        (acc, [key, value]) => {
          if (value !== undefined) {
            acc[key] = String(value);
          }
          return acc;
        },
        {} as { [key: string]: string },
      );
    }

    // Apply default settings for S3Queue if not already specified
    if (engineConfig?.engine === "S3Queue") {
      if (!tableSettings) {
        tableSettings = {};
      }
      // Set default mode to 'unordered' if not specified
      if (!tableSettings.mode) {
        tableSettings.mode = "unordered";
      }
    }

    // Determine ORDER BY from config
    // Note: engines like Buffer and Distributed don't support orderBy/partitionBy/sampleBy
    const hasOrderByFields =
      "orderByFields" in table.config &&
      Array.isArray(table.config.orderByFields) &&
      table.config.orderByFields.length > 0;
    const hasOrderByExpression =
      "orderByExpression" in table.config &&
      typeof table.config.orderByExpression === "string" &&
      table.config.orderByExpression.length > 0;
    if (hasOrderByFields && hasOrderByExpression) {
      throw new Error(
        `Table ${table.name}: Provide either orderByFields or orderByExpression, not both.`,
      );
    }
    const orderBy: string[] | string =
      hasOrderByExpression && "orderByExpression" in table.config ?
        (table.config.orderByExpression ?? "")
      : "orderByFields" in table.config ? (table.config.orderByFields ?? [])
      : [];

    tables[id] = {
      name: table.name,
      columns: table.columnArray,
      orderBy,
      partitionBy:
        "partitionBy" in table.config ? table.config.partitionBy : undefined,
      sampleByExpression:
        "sampleByExpression" in table.config ?
          table.config.sampleByExpression
        : undefined,
      engineConfig,
      version: table.config.version,
      metadata,
      lifeCycle: table.config.lifeCycle,
      // Map 'settings' to 'tableSettings' for internal use
      tableSettings:
        tableSettings && Object.keys(tableSettings).length > 0 ?
          tableSettings
        : undefined,
      indexes:
        table.config.indexes?.map((i) => ({
          ...i,
          granularity: i.granularity === undefined ? 1 : i.granularity,
          arguments: i.arguments === undefined ? [] : i.arguments,
        })) || [],
      ttl: table.config.ttl,
      database: table.config.database,
    };
  });

  registry.streams.forEach((stream) => {
    // If the stream is part of an IngestPipeline, inherit metadata if not set
    let metadata = stream.metadata;
    if (!metadata && stream.config && (stream as any).pipelineParent) {
      metadata = (stream as any).pipelineParent.metadata;
    }
    const transformationTargets: Target[] = [];
    const consumers: Consumer[] = [];

    stream._transformations.forEach((transforms, destinationName) => {
      transforms.forEach(([destination, _, config]) => {
        transformationTargets.push({
          kind: "stream",
          name: destinationName,
          version: config.version,
          metadata: config.metadata,
        });
      });
    });

    stream._consumers.forEach((consumer) => {
      consumers.push({
        version: consumer.config.version,
      });
    });

    topics[stream.name] = {
      name: stream.name,
      columns: stream.columnArray,
      targetTable: stream.config.destination?.name,
      targetTableVersion: stream.config.destination?.config.version,
      retentionPeriod: stream.config.retentionPeriod ?? defaultRetentionPeriod,
      partitionCount: stream.config.parallelism ?? 1,
      version: stream.config.version,
      transformationTargets,
      hasMultiTransform: stream._multipleTransformations === undefined,
      consumers,
      metadata,
      lifeCycle: stream.config.lifeCycle,
      schemaConfig: stream.config.schemaConfig,
    };
  });

  registry.ingestApis.forEach((api) => {
    // If the ingestApi is part of an IngestPipeline, inherit metadata if not set
    let metadata = api.metadata;
    if (!metadata && api.config && (api as any).pipelineParent) {
      metadata = (api as any).pipelineParent.metadata;
    }
    ingestApis[api.name] = {
      name: api.name,
      columns: api.columnArray,
      version: api.config.version,
      path: api.config.path,
      writeTo: {
        kind: "stream",
        name: api.config.destination.name,
      },
      deadLetterQueue: api.config.deadLetterQueue?.name,
      metadata,
      schema: api.schema,
    };
  });

  registry.apis.forEach((api, key) => {
    const rustKey =
      api.config.version ? `${api.name}:${api.config.version}` : api.name;
    apis[rustKey] = {
      name: api.name,
      queryParams: api.columnArray,
      responseSchema: api.responseSchema,
      version: api.config.version,
      path: api.config.path,
      metadata: api.metadata,
    };
  });

  registry.sqlResources.forEach((sqlResource) => {
    sqlResources[sqlResource.name] = {
      name: sqlResource.name,
      setup: sqlResource.setup,
      teardown: sqlResource.teardown,

      pullsDataFrom: sqlResource.pullsDataFrom.map((r) => {
        if (r.kind === "OlapTable") {
          const table = r as OlapTable<any>;
          const id =
            table.config.version ?
              `${table.name}_${table.config.version}`
            : table.name;
          return {
            id,
            kind: "Table",
          };
        } else if (r.kind === "SqlResource") {
          const resource = r as SqlResource;
          return {
            id: resource.name,
            kind: "SqlResource",
          };
        } else {
          throw new Error(`Unknown sql resource dependency type: ${r}`);
        }
      }),
      pushesDataTo: sqlResource.pushesDataTo.map((r) => {
        if (r.kind === "OlapTable") {
          const table = r as OlapTable<any>;
          const id =
            table.config.version ?
              `${table.name}_${table.config.version}`
            : table.name;
          return {
            id,
            kind: "Table",
          };
        } else if (r.kind === "SqlResource") {
          const resource = r as SqlResource;
          return {
            id: resource.name,
            kind: "SqlResource",
          };
        } else {
          throw new Error(`Unknown sql resource dependency type: ${r}`);
        }
      }),
    };
  });

  registry.workflows.forEach((workflow) => {
    workflows[workflow.name] = {
      name: workflow.name,
      retries: workflow.config.retries,
      timeout: workflow.config.timeout,
      schedule: workflow.config.schedule,
    };
  });

  registry.webApps.forEach((webApp) => {
    webApps[webApp.name] = {
      name: webApp.name,
      mountPath: webApp.config.mountPath || "/",
      metadata: webApp.config.metadata,
    };
  });

  return {
    topics,
    tables,
    ingestApis,
    apis,
    sqlResources,
    workflows,
    webApps,
  };
};

/**
 * Retrieves the global internal Moose resource registry.
 * Uses `globalThis` to ensure a single registry instance.
 *
 * @returns The internal Moose resource registry.
 */
export const getMooseInternal = (): typeof moose_internal =>
  (globalThis as any).moose_internal;

// work around for variable visibility in compiler output
if (getMooseInternal() === undefined) {
  (globalThis as any).moose_internal = moose_internal;
}

/**
 * Loads the user's application entry point (`app/index.ts`) to register resources,
 * then generates and prints the infrastructure map as JSON.
 *
 * This function is the main entry point used by the Moose infrastructure system
 * to discover the defined resources.
 * It prints the JSON map surrounded by specific delimiters (`___MOOSE_STUFF___start`
 * and `end___MOOSE_STUFF___`) for easy extraction by the calling process.
 */
export const dumpMooseInternal = async () => {
  loadIndex();

  console.log(
    "___MOOSE_STUFF___start",
    JSON.stringify(toInfraMap(getMooseInternal())),
    "end___MOOSE_STUFF___",
  );
};

const loadIndex = () => {
  // Clear the registry before loading to support hot reloading
  const registry = getMooseInternal();
  registry.tables.clear();
  registry.streams.clear();
  registry.ingestApis.clear();
  registry.apis.clear();
  registry.sqlResources.clear();
  registry.workflows.clear();
  registry.webApps.clear();

  // Clear require cache for app directory to pick up changes
  const appDir = `${process.cwd()}/${getSourceDir()}`;
  Object.keys(require.cache).forEach((key) => {
    if (key.startsWith(appDir)) {
      delete require.cache[key];
    }
  });

  try {
    require(`${process.cwd()}/${getSourceDir()}/index.ts`);
  } catch (error) {
    let hint: string | undefined;
    const details = error instanceof Error ? error.message : String(error);
    if (details.includes("ERR_REQUIRE_ESM") || details.includes("ES Module")) {
      hint =
        "The file or its dependencies are ESM-only. Switch to packages that dual-support CJS & ESM, or upgrade to Node 22.12+. " +
        "If you must use Node 20, you may try Node 20.19\n\n";
    }

    const errorMsg = `${hint ?? ""}${details}`;
    const cause = error instanceof Error ? error : undefined;
    throw new Error(errorMsg, { cause });
  }
};

/**
 * Loads the user's application entry point and extracts all registered stream
 * transformation and consumer functions.
 *
 * @returns A Map where keys are unique identifiers for transformations/consumers
 *          (e.g., "sourceStream_destStream_version", "sourceStream_<no-target>_version")
 *          and values are the corresponding handler functions.
 */
export const getStreamingFunctions = async () => {
  loadIndex();

  const registry = getMooseInternal();
  const transformFunctions = new Map<
    string,
    [(data: unknown) => unknown, TransformConfig<any> | ConsumerConfig<any>]
  >();

  registry.streams.forEach((stream) => {
    stream._transformations.forEach((transforms, destinationName) => {
      transforms.forEach(([_, transform, config]) => {
        const transformFunctionKey = `${stream.name}_${destinationName}${config.version ? `_${config.version}` : ""}`;
        compilerLog(`getStreamingFunctions: ${transformFunctionKey}`);
        transformFunctions.set(transformFunctionKey, [transform, config]);
      });
    });

    stream._consumers.forEach((consumer) => {
      const consumerFunctionKey = `${stream.name}_<no-target>${consumer.config.version ? `_${consumer.config.version}` : ""}`;
      transformFunctions.set(consumerFunctionKey, [
        consumer.consumer,
        consumer.config,
      ]);
    });
  });

  return transformFunctions;
};

/**
 * Loads the user's application entry point and extracts all registered
 * API handler functions.
 *
 * @returns A Map where keys are the names of the APIs and values
 *          are their corresponding handler functions.
 */
export const getApis = async () => {
  loadIndex();
  const apiFunctions = new Map<
    string,
    (params: unknown, utils: ApiUtil) => unknown
  >();

  const registry = getMooseInternal();
  // Single pass: store full keys, track aliasing decisions
  const versionCountByName = new Map<string, number>();
  const nameToSoleVersionHandler = new Map<
    string,
    (params: unknown, utils: ApiUtil) => unknown
  >();

  registry.apis.forEach((api, key) => {
    const handler = api.getHandler();
    apiFunctions.set(key, handler);

    if (!api.config.version) {
      // Explicit unversioned takes precedence for alias
      if (!apiFunctions.has(api.name)) {
        apiFunctions.set(api.name, handler);
      }
      nameToSoleVersionHandler.delete(api.name);
      versionCountByName.delete(api.name);
    } else if (!apiFunctions.has(api.name)) {
      // Only track versioned for alias if no explicit unversioned present
      const count = (versionCountByName.get(api.name) ?? 0) + 1;
      versionCountByName.set(api.name, count);
      if (count === 1) {
        nameToSoleVersionHandler.set(api.name, handler);
      } else {
        nameToSoleVersionHandler.delete(api.name);
      }
    }
  });

  // Finalize aliases for names that have exactly one versioned API and no unversioned
  nameToSoleVersionHandler.forEach((handler, name) => {
    if (!apiFunctions.has(name)) {
      apiFunctions.set(name, handler);
    }
  });

  return apiFunctions;
};

export const dlqSchema: IJsonSchemaCollection.IV3_1 = {
  version: "3.1",
  components: {
    schemas: {
      DeadLetterModel: {
        type: "object",
        properties: {
          originalRecord: {
            $ref: "#/components/schemas/Recordstringany",
          },
          errorMessage: {
            type: "string",
          },
          errorType: {
            type: "string",
          },
          failedAt: {
            type: "string",
            format: "date-time",
          },
          source: {
            oneOf: [
              {
                const: "api",
              },
              {
                const: "transform",
              },
              {
                const: "table",
              },
            ],
          },
        },
        required: [
          "originalRecord",
          "errorMessage",
          "errorType",
          "failedAt",
          "source",
        ],
      },
      Recordstringany: {
        type: "object",
        properties: {},
        required: [],
        description: "Construct a type with a set of properties K of type T",
        additionalProperties: {},
      },
    },
  },
  schemas: [
    {
      $ref: "#/components/schemas/DeadLetterModel",
    },
  ],
};

export const dlqColumns: Column[] = [
  {
    name: "originalRecord",
    data_type: "Json",
    primary_key: false,
    required: true,
    unique: false,
    default: null,
    annotations: [],
    ttl: null,
  },
  {
    name: "errorMessage",
    data_type: "String",
    primary_key: false,
    required: true,
    unique: false,
    default: null,
    annotations: [],
    ttl: null,
  },
  {
    name: "errorType",
    data_type: "String",
    primary_key: false,
    required: true,
    unique: false,
    default: null,
    annotations: [],
    ttl: null,
  },
  {
    name: "failedAt",
    data_type: "DateTime",
    primary_key: false,
    required: true,
    unique: false,
    default: null,
    annotations: [],
    ttl: null,
  },
  {
    name: "source",
    data_type: "String",
    primary_key: false,
    required: true,
    unique: false,
    default: null,
    annotations: [],
    ttl: null,
  },
];

export const getWorkflows = async () => {
  loadIndex();

  const registry = getMooseInternal();
  return registry.workflows;
};

function findTaskInTree(
  task: Task<any, any>,
  targetName: string,
): Task<any, any> | undefined {
  if (task.name === targetName) {
    return task;
  }

  if (task.config.onComplete?.length) {
    for (const childTask of task.config.onComplete) {
      const found = findTaskInTree(childTask, targetName);
      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

export const getTaskForWorkflow = async (
  workflowName: string,
  taskName: string,
): Promise<Task<any, any>> => {
  const workflows = await getWorkflows();
  const workflow = workflows.get(workflowName);
  if (!workflow) {
    throw new Error(`Workflow ${workflowName} not found`);
  }

  const task = findTaskInTree(
    workflow.config.startingTask as Task<any, any>,
    taskName,
  );
  if (!task) {
    throw new Error(`Task ${taskName} not found in workflow ${workflowName}`);
  }

  return task;
};

export const getWebApps = async () => {
  loadIndex();
  return getMooseInternal().webApps;
};
