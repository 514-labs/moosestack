---
title: TypeScript Table Configuration
description: Configure ClickHouse table engines, sorting keys, and advanced storage options
priority: 0.70
category: database-config
language: typescript
---

# Table Setup

## Overview
Tables in DMv2 are created using the `OlapTable` class, which provides a type-safe way to define your data infrastructure.

## Basic Table Configuration

```typescript
import { OlapTable, Key } from '@514labs/moose-lib';

// Basic table configuration
export const Example = new OlapTable("Example");
```

## Multi-Database Support

By default, tables are created in the global ClickHouse database configured in your Moose project. You can optionally specify a different database for any table using the `database` field:

```typescript
import { OlapTable, Key } from '@514labs/moose-lib';

interface MyData {
  id: Key<string>;
  value: number;
}

// Table created in the default database
export const DefaultTable = new OlapTable<MyData>("DefaultTable");

// Table created in a specific database
export const AnalyticsTable = new OlapTable<MyData>("AnalyticsTable", {
  database: "analytics_db",
  orderByFields: ["id"]
});
```

**Notes**:
- If `database` is not specified, the table is created in the global database from your Moose configuration
- The database must exist in your ClickHouse cluster
- All table operations (queries, writes) will target the specified database
- **Changing the `database` field requires manual migration**: Create a new table with the target database, migrate your data, then delete the old table definition. This prevents accidental data loss.

## Table Configuration Options

The `OlapTable` class supports both a modern discriminated union API and legacy configuration for backward compatibility.

### Modern API (Recommended)

```typescript
// Engine-specific configurations with type safety
// All configurations support an optional 'database' field
type OlapConfig<T> =
  | { engine: ClickHouseEngines.MergeTree; orderByFields?: (keyof T & string)[]; settings?: { [key: string]: string }; database?: string; }
  | {
      engine: ClickHouseEngines.ReplacingMergeTree;
      orderByFields?: (keyof T & string)[];
      ver?: keyof T & string;        // Optional: version column for keeping latest
      isDeleted?: keyof T & string;   // Optional: soft delete marker (requires ver)
      settings?: { [key: string]: string };
      database?: string;              // Optional: target database
    }
  | { 
      engine: ClickHouseEngines.ReplicatedMergeTree;
      keeperPath?: string;   // Optional: ZooKeeper/Keeper path (omit for ClickHouse Cloud/Boreal)
      replicaName?: string;  // Optional: replica name (omit for ClickHouse Cloud/Boreal)
      orderByFields?: (keyof T & string)[]; 
      settings?: { [key: string]: string }; 
    }
  | { 
      engine: ClickHouseEngines.ReplicatedReplacingMergeTree;
      keeperPath?: string;   // Optional: ZooKeeper/Keeper path (omit for ClickHouse Cloud/Boreal)
      replicaName?: string;  // Optional: replica name (omit for ClickHouse Cloud/Boreal)
      ver?: keyof T & string;        // Optional: version column
      isDeleted?: keyof T & string;   // Optional: soft delete marker
      orderByFields?: (keyof T & string)[]; 
      settings?: { [key: string]: string }; 
    }
  | { 
      engine: ClickHouseEngines.S3Queue;
      s3Path: string;        // S3 bucket path
      format: string;        // Data format
      awsAccessKeyId?: string;
      awsSecretAccessKey?: string;
      compression?: string;
      headers?: { [key: string]: string };
      settings?: { [key: string]: string };  // Table-level settings including S3Queue-specific ones
    };
```



### Key Requirements

When defining your schema, you must either:
1. Use `Key<T>` for one of the top-level fields, or
2. Specify the key field in `orderByFields`

Important requirements:
- If you use `Key<T>`, it must be the first field in `orderByFields` when specified
- Fields used in `orderByFields` must not be nullable (no optional fields or union with null)

### Basic Configuration Examples

```typescript
// Table with Key<T> field
interface KeyedSchema {
  id: Key<string>;
  name: string;
  value: number;
  createdAt: Date;      // Non-nullable field - can be used in orderByFields
  updatedAt?: Date;     // Nullable field - cannot be used in orderByFields
}

export const Keyed = new OlapTable("Keyed", {
  orderByFields: ["id", "createdAt"]  // Only non-nullable fields allowed
});

// ❌ Invalid: Cannot use nullable fields in orderByFields
export const InvalidKeyed = new OlapTable("InvalidKeyed", {
  orderByFields: ["id", "updatedAt"]  // Error: Cannot use nullable field 'updatedAt'
});

// Table with key specified in orderByFields
interface UnkeyedSchema {
  id: string;
  name: string;
  value: number;
}

export const Unkeyed = new OlapTable("Unkeyed", {
  orderByFields: ["id"]  // Key field must be non-nullable
});
```

## Table Examples

### Basic Table with Key
```typescript
// Simple schema with Key<T>
interface BasicSchema {
  id: Key<string>;
  name: string;
  value: number;
  active: boolean;
}

// Basic table with Key field
export const Basic = new OlapTable("Basic", {
  orderByFields: ["id"]  // Key field must be first
});
```

### Table with Ordering and Key
```typescript
// Schema with Key<T> and timestamp
interface TimeSeriesSchema {
  id: Key<string>;
  timestamp: Date;
  value: number;
  metadata: {
    source: string;
  };
}

// Table with Key field and ordering
export const TimeSeries = new OlapTable("TimeSeries", {
  orderByFields: ["id", "timestamp"]  // Key field must be first
});
```

### Table with Deduplication and Key
```typescript
// Schema with Key<T> and versioning
interface VersionedSchema {
  id: Key<string>;
  version: number;
  data: string;
  updatedAt: Date;
}

// Table that keeps only the latest version
export const Versioned = new OlapTable("Versioned", {
  engine: ClickHouseEngines.ReplacingMergeTree,
  orderByFields: ["id", "version", "updatedAt"],  // Key field must be first
  ver: "updatedAt",  // Optional: keeps row with max updatedAt value
  isDeleted: "deleted"  // Optional: soft delete when deleted=1 (requires ver)
});
```

### Replicated Engine Tables

Replicated engines provide high availability and data replication across multiple ClickHouse nodes.

```typescript
import { OlapTable, ClickHouseEngines, Key } from '@514labs/moose-lib';

interface ReplicatedSchema {
  id: Key<string>;
  data: string;
  timestamp: Date;
}

// Recommended: Omit parameters for automatic defaults (works in both Cloud and self-managed)
export const ReplicatedTable = new OlapTable<ReplicatedSchema>("ReplicatedTable", {
  engine: ClickHouseEngines.ReplicatedMergeTree,
  // No keeperPath or replicaName - uses smart defaults: /clickhouse/tables/{uuid}/{shard} and {replica}
  orderByFields: ["id", "timestamp"]
});

// Optional: Explicit paths for custom configurations
export const CustomReplicatedTable = new OlapTable<ReplicatedSchema>("CustomReplicatedTable", {
  engine: ClickHouseEngines.ReplicatedMergeTree,
  keeperPath: "/clickhouse/tables/{database}/{shard}/custom_table",
  replicaName: "{replica}",
  orderByFields: ["id"]
});

// Replicated with deduplication
export const ReplicatedDedup = new OlapTable<ReplicatedSchema>("ReplicatedDedup", {
  engine: ClickHouseEngines.ReplicatedReplacingMergeTree,
  keeperPath: "/clickhouse/tables/{database}/{shard}/replicated_dedup",
  replicaName: "{replica}",
  ver: "timestamp",
  isDeleted: "deleted",
  orderByFields: ["id"]
});
```

**Note**: The `keeperPath` and `replicaName` parameters are optional:
- **Self-managed ClickHouse**: Both parameters are required for configuring ZooKeeper/ClickHouse Keeper paths
- **ClickHouse Cloud / Boreal**: Omit both parameters - the platform manages replication automatically

### Cluster-Aware Replicated Tables

For multi-node ClickHouse deployments, you can specify a cluster name to use `ON CLUSTER` DDL operations:

```typescript
import { OlapTable, ClickHouseEngines, Key } from '@514labs/moose-lib';

interface ReplicatedSchema {
  id: Key<string>;
  data: string;
  timestamp: Date;
}

// Replicated table on a cluster
export const ClusteredTable = new OlapTable<ReplicatedSchema>("ClusteredTable", {
  engine: ClickHouseEngines.ReplicatedMergeTree,
  orderByFields: ["id"],
  cluster: "default"  // References cluster from moose.config.toml
});
```

**Configuration in `moose.config.toml`:**
```toml
[[clickhouse_config.clusters]]
name = "default"
```

**When to omit all parameters (recommended):**
- ✅ **ClickHouse Cloud** - Platform manages replication automatically
- ✅ **Local development** - Moose auto-injects params: `/clickhouse/tables/{database}/{shard}/{table_name}`
- ✅ **Most production deployments** - Works out of the box

**When to use `cluster`:**
- ✅ Multi-node self-managed ClickHouse with cluster configuration
- ✅ Need `ON CLUSTER` DDL for distributed operations
- ✅ Works without explicit `keeperPath`/`replicaName` parameters

**When to use explicit `keeperPath`/`replicaName`:**
- ✅ Custom replication topology required
- ✅ Advanced ZooKeeper/Keeper configuration
- ✅ Specific self-managed deployment requirements

**Important:** Cannot specify both `cluster` and explicit `keeperPath`/`replicaName` - choose one approach.

**Local Development:** Moose configures cluster names to point to your local ClickHouse instance, letting you develop with `ON CLUSTER` DDL without running multiple nodes.

**Production:** Cluster names must match your ClickHouse `remote_servers` configuration.

#### Understanding `cluster` as a Deployment Directive

The `cluster` field is a **deployment directive** that controls HOW Moose runs DDL operations, not WHAT the table looks like:

- **Changing `cluster` won't recreate your table** - it only affects future DDL operations (CREATE, ALTER, etc.)
- **ClickHouse doesn't store cluster information** - the `ON CLUSTER` clause is only used during DDL execution
- **`moose init --from-remote` & `moose db pull` cannot detect cluster names** - ClickHouse system tables don't preserve this information

**If you're importing existing tables that were created with `ON CLUSTER`:**
1. Run `moose init --from-remote` to generate your table definitions
2. Manually add `cluster: "your_cluster_name"` to the generated table configs
3. Future migrations and DDL operations will correctly use `ON CLUSTER`

**Example workflow:**
```typescript
// After moose init --from-remote generates this:
export const MyTable = new OlapTable<MySchema>("MyTable", {
  orderByFields: ["id"]
});

// Manually add cluster if you know it was created with ON CLUSTER:
export const MyTable = new OlapTable<MySchema>("MyTable", {
  orderByFields: ["id"],
  cluster: "my_cluster"  // Add this line
});
```

### S3Queue Engine Tables

The S3Queue engine allows you to automatically process files from S3 buckets as they arrive.

#### Modern API (Recommended)

```typescript
import { OlapTable, ClickHouseEngines } from '@514labs/moose-lib';

// Schema for S3 data
interface S3EventSchema {
  id: Key<string>;
  event_type: string;
  timestamp: Date;
  data: any;
}

// Direct configuration with new API
export const S3Events = new OlapTable("S3Events", {
  engine: ClickHouseEngines.S3Queue,
  s3Path: "s3://my-bucket/events/*.json",
  format: "JSONEachRow",
  // Optional authentication (omit for public buckets)
  // ⚠️ WARNING: Never hardcode credentials directly!
  // Use mooseRuntimeEnv for runtime environment variable resolution (see below)
  awsAccessKeyId: "AKIA...",
  awsSecretAccessKey: "secret...",
  // Optional compression
  compression: "gzip",
  // Table-level settings including S3Queue-specific settings (ClickHouse 24.7+)
  settings: {
    mode: "unordered",  // or "ordered" for sequential processing
    keeper_path: "/clickhouse/s3queue/s3_events",
    loading_retries: "3",
    processing_threads_num: "4",
    // Additional settings as needed
  },
});

// Public S3 bucket example (no credentials needed)
export const PublicS3Data = new OlapTable<any>("PublicS3Data", {
  engine: ClickHouseEngines.S3Queue,
  s3Path: "s3://public-bucket/data/*.csv",
  format: "CSV",
  settings: {
    mode: "ordered",
    keeper_path: "/clickhouse/s3queue/public_data"
  }
});
```

#### Runtime Environment Variable Resolution (Recommended for Credentials)

**⚠️ IMPORTANT: Never hardcode AWS credentials in your code!** Hardcoded credentials get embedded in Docker images and deployment artifacts, creating serious security risks.

Instead, use `mooseRuntimeEnv` to defer credential resolution until runtime:

```typescript
import { OlapTable, ClickHouseEngines, mooseRuntimeEnv } from '@514labs/moose-lib';

// ✅ RECOMMENDED: Runtime environment variable resolution
export const SecureS3Events = new OlapTable("SecureS3Events", {
  engine: ClickHouseEngines.S3Queue,
  s3Path: "s3://my-bucket/events/*.json",
  format: "JSONEachRow",
  // Credentials resolved from environment variables at runtime
  awsAccessKeyId: mooseRuntimeEnv.get("AWS_ACCESS_KEY_ID"),
  awsSecretAccessKey: mooseRuntimeEnv.get("AWS_SECRET_ACCESS_KEY"),
  settings: {
    mode: "unordered",
    keeper_path: "/clickhouse/s3queue/s3_events"
  }
});
```

**How it works:**
1. `mooseRuntimeEnv.get("VAR_NAME")` creates a marker in your code
2. When you build your application, these markers (not actual values) are serialized
3. At runtime, the Moose CLI reads the environment variables and resolves the actual values
4. Credentials never get embedded in Docker images or deployment artifacts

**Setting environment variables:**
```bash
# In your deployment environment
export AWS_ACCESS_KEY_ID="AKIA..."
export AWS_SECRET_ACCESS_KEY="your-secret-key"

# Then start Moose
moose prod up
```

**Benefits:**
- ✅ Credentials never embedded in Docker images
- ✅ Supports credential rotation (changing passwords triggers table recreation)
- ✅ Different credentials for different environments (dev/staging/prod)
- ✅ Clear error messages if environment variables are missing

#### Legacy API (Still Supported)

```typescript
// Legacy configuration format (deprecated - will show warning)
export const S3EventsLegacy = new OlapTable("S3EventsLegacy", {
  engine: ClickHouseEngines.S3Queue,
  s3QueueEngineConfig: {
    path: "s3://my-bucket/events/*.json",
    format: "JSONEachRow",
    aws_access_key_id: "AKIA...",
    aws_secret_access_key: "secret...",
    compression: "gzip"
    // Note: In legacy API, S3Queue-specific settings were in a nested 'settings' object
    // This has been removed - settings now go at the table level
  },
  // S3Queue-specific settings now go here (can be altered without recreating table)
  // Note: ClickHouse 24.7+ uses settings without 's3queue_' prefix
  settings: {
    mode: "unordered",
    keeper_path: "/clickhouse/s3queue/s3_events",
    loading_retries: "3"
  }
});
```

#### S3Queue Configuration Options

```typescript
// S3Queue Engine Configuration (constructor parameters - cannot be changed after creation)
interface S3QueueEngineConfig {
  s3Path: string;                  // S3 path pattern (e.g., 's3://bucket/data/*.json')
  format: string;                  // Data format (e.g., 'JSONEachRow', 'CSV', 'Parquet')
  awsAccessKeyId?: string;         // AWS access key (omit for public buckets)
  awsSecretAccessKey?: string;     // AWS secret key (paired with access key)
  compression?: string;            // Optional: 'gzip', 'brotli', 'xz', 'zstd', etc.
  headers?: { [key: string]: string }; // Optional: custom HTTP headers
}

// S3Queue-specific settings (go in the 'settings' field - can be modified with ALTER TABLE)
// Note: Since ClickHouse 24.7, settings don't require the 's3queue_' prefix
// Note: If not specified, 'mode' defaults to 'unordered'
interface S3QueueSettings {
  mode?: string;                                  // "ordered" or "unordered" (default) - Processing mode
  after_processing?: string;                      // "keep" or "delete" - What to do with files after processing
  keeper_path?: string;                            // ZooKeeper/Keeper path for coordination
  loading_retries?: string;                       // Number of retry attempts
  processing_threads_num?: string;                // Number of processing threads
  parallel_inserts?: string;                      // Enable parallel inserts ("true"/"false")
  enable_logging_to_queue_log?: string;           // Enable logging to system.s3queue_log ("true"/"false")
  last_processed_path?: string;                   // Last processed file path (for ordered mode)
  tracked_files_limit?: string;                   // Maximum number of tracked files in ZooKeeper
  tracked_file_ttl_sec?: string;                  // TTL for tracked files in seconds
  polling_min_timeout_ms?: string;                // Min polling timeout
  polling_max_timeout_ms?: string;                // Max polling timeout
  polling_backoff_ms?: string;                    // Polling backoff
  cleanup_interval_min_ms?: string;               // Minimum cleanup interval
  cleanup_interval_max_ms?: string;               // Maximum cleanup interval
  buckets?: string;                               // Number of buckets for sharding (0 = disabled)
  list_objects_batch_size?: string;               // Batch size for listing objects
  enable_hash_ring_filtering?: string;            // Enable hash ring filtering ("0" or "1")
  max_processed_files_before_commit?: string;     // Max files before commit
  max_processed_rows_before_commit?: string;      // Max rows before commit
  max_processed_bytes_before_commit?: string;     // Max bytes before commit
  max_processing_time_sec_before_commit?: string; // Max processing time before commit
  [key: string]: string;                          // Additional settings (all values are strings)
}
```

### S3 Engine Tables

The S3 engine provides direct read/write access to S3 storage without streaming semantics. Unlike S3Queue, it's designed for batch processing or querying static data.

#### Modern API (Recommended)

```typescript
import { OlapTable, ClickHouseEngines, mooseRuntimeEnv } from '@514labs/moose-lib';

interface S3DataSchema {
  id: Key<string>;
  timestamp: DateTime;
  data: any;
}

// S3 table with credentials (recommended with mooseRuntimeEnv)
export const S3Data = new OlapTable<S3DataSchema>("S3Data", {
  engine: ClickHouseEngines.S3,
  path: "s3://my-bucket/data/file.json",
  format: "JSONEachRow",
  // Credentials resolved from environment variables at runtime
  awsAccessKeyId: mooseRuntimeEnv.get("AWS_ACCESS_KEY_ID"),
  awsSecretAccessKey: mooseRuntimeEnv.get("AWS_SECRET_ACCESS_KEY"),
  compression: "gzip"
});

// Public S3 bucket (no authentication needed)
export const PublicS3 = new OlapTable<S3DataSchema>("PublicS3", {
  engine: ClickHouseEngines.S3,
  path: "s3://public-bucket/data/*.parquet",
  format: "Parquet",
  noSign: true  // Use NOSIGN for public buckets
});
```

#### S3 Engine Configuration Options

```typescript
// S3 Engine Configuration (constructor parameters - cannot be changed after creation)
interface S3EngineConfig {
  path: string;                       // S3 path (e.g., 's3://bucket/data/file.json')
  format: string;                     // Data format (e.g., 'JSONEachRow', 'CSV', 'Parquet')
  noSign?: boolean;                   // Use NOSIGN for public buckets (no authentication)
  awsAccessKeyId?: string;            // AWS access key (omit for public buckets or if using noSign)
  awsSecretAccessKey?: string;        // AWS secret key (paired with access key)
  compression?: string;               // Optional: 'gzip', 'brotli', 'xz', 'zstd', 'auto', etc.
  partitionStrategy?: string;         // Optional: partitioning strategy
  partitionColumnsInDataFile?: string; // Optional: partition columns
}
```

#### S3 vs S3Queue

- **S3**: Direct read/write access to S3 files. Use for batch processing, querying static data, or one-time imports.
- **S3Queue**: Streaming engine that automatically processes new files as they arrive. Use for continuous data ingestion.

Both engines support the same credential management and format options.

### Buffer Engine Tables

The Buffer engine provides an in-memory buffer that flushes data to a destination table based on time, row count, or size thresholds. This is useful for high-throughput scenarios where you want to batch writes.

#### Modern API (Recommended)

```typescript
import { OlapTable, ClickHouseEngines } from '@514labs/moose-lib';

interface RecordSchema {
  id: Key<string>;
  timestamp: DateTime;
  value: number;
}

// First create the destination table
export const DestinationTable = new OlapTable<RecordSchema>("DestinationTable", {
  engine: ClickHouseEngines.MergeTree,
  orderByFields: ["id", "timestamp"]
});

// Then create the buffer table that points to it
export const BufferTable = new OlapTable<RecordSchema>("BufferTable", {
  engine: ClickHouseEngines.Buffer,
  targetDatabase: "local",
  targetTable: "DestinationTable",
  numLayers: 16,
  minTime: 10,        // Minimum 10 seconds before flush
  maxTime: 100,       // Maximum 100 seconds before flush
  minRows: 10000,     // Minimum 10k rows before flush
  maxRows: 1000000,   // Maximum 1M rows before flush
  minBytes: 10485760, // Minimum 10MB before flush
  maxBytes: 104857600 // Maximum 100MB before flush
});
```

#### Buffer Engine Configuration Options

```typescript
// Buffer Engine Configuration
interface BufferEngineConfig {
  targetDatabase: string;  // Database name of destination table
  targetTable: string;     // Name of destination table
  numLayers: number;       // Number of buffer layers (typically 16)
  minTime: number;         // Minimum time in seconds before flushing
  maxTime: number;         // Maximum time in seconds before flushing
  minRows: number;         // Minimum number of rows before flushing
  maxRows: number;         // Maximum number of rows before flushing
  minBytes: number;        // Minimum bytes before flushing
  maxBytes: number;        // Maximum bytes before flushing
  flushTime?: number;      // Optional: flush time override
  flushRows?: number;      // Optional: flush rows override
  flushBytes?: number;     // Optional: flush bytes override
}
```

#### Buffer Engine Considerations

**⚠️ Important Caveats:**
- Data in buffer is **lost if server crashes** before flush
- Not suitable for critical data that must be durable
- Best for high-throughput scenarios where minor data loss is acceptable
- Buffer and destination table must have identical schemas
- Buffer tables don't support `orderByFields`, `partitionBy`, or `sampleByExpression`

**Use Cases:**
1. **High-throughput ingestion**: Reduce the overhead of many small inserts
2. **Smoothing write load**: Buffer bursty writes and flush in larger batches
3. **Real-time dashboards**: Trade durability for lower write latency

For more details, see the [ClickHouse Buffer documentation](https://clickhouse.com/docs/en/engines/table-engines/special/buffer).

### Distributed Engine Tables

The Distributed engine creates a distributed table across a ClickHouse cluster for horizontal scaling and query parallelization.

#### Modern API (Recommended)

```typescript
import { OlapTable, ClickHouseEngines } from '@514labs/moose-lib';

interface RecordSchema {
  id: Key<string>;
  timestamp: DateTime;
  value: number;
}

// Distributed table across cluster
export const DistributedTable = new OlapTable<RecordSchema>("DistributedTable", {
  engine: ClickHouseEngines.Distributed,
  cluster: "my_cluster",
  targetDatabase: "default",
  targetTable: "local_table",
  shardingKey: "cityHash64(id)"  // Optional: how to distribute data
});
```

#### Distributed Engine Configuration Options

```typescript
// Distributed Engine Configuration
interface DistributedEngineConfig {
  cluster: string;         // Cluster name from ClickHouse configuration
  targetDatabase: string;  // Database name on the cluster
  targetTable: string;     // Table name on the cluster (must exist on all nodes)
  shardingKey?: string;    // Optional: sharding key expression (e.g., 'cityHash64(id)')
  policyName?: string;     // Optional: policy name for data distribution
}
```

#### Distributed Table Requirements

- Requires a configured ClickHouse cluster with `remote_servers` configuration
- The local table must exist on all cluster nodes with identical schema
- Distributed tables are virtual - actual data is stored in local tables
- Distributed tables don't support `orderByFields`, `partitionBy`, or `sampleByExpression`
- The `cluster` name must match a cluster defined in your ClickHouse configuration

**Use Cases:**
1. **Horizontal scaling**: Distribute data across multiple nodes for larger datasets
2. **Query parallelization**: Speed up queries by executing them across cluster nodes
3. **Load distribution**: Balance write and read load across multiple servers
4. **Geographic distribution**: Place data closer to users in different regions

For more details, see the [ClickHouse Distributed documentation](https://clickhouse.com/docs/en/engines/table-engines/special/distributed).

## Best Practices

1. **Sorting Key Fields**:
   - Use only non-nullable fields in `orderByFields`
   - Make sure key fields are always populated
   - Consider using default values instead of optional fields for sorting keys

2. **Schema Design**:
   - Mark fields as optional (`?`) only when they truly can be missing
   - Use non-nullable fields for important indexing and sorting columns
   - Consider the query patterns when choosing sorting keys

## How It Works

When you create an `OlapTable` instance:
1. The table is registered in the global Moose registry
2. The schema is stored as JSON Schema (v3.1)
3. When deployed, Moose creates the corresponding infrastructure

## Development Workflow

### Local Development with Hot Reloading

One of the powerful features of DMv2 is its integration with the Moose development server:

1. Start your local development server with `moose dev`
2. When you define or modify an `OlapTable` in your code and save the file:
   - The changes are automatically detected
   - The TypeScript compiler plugin processes your schema definitions
   - The infrastructure is updated in real-time to match your code changes
   - Your tables are immediately available for testing

For example, if you add a new field to your schema:
```typescript
// Before
interface BasicSchema {
  id: Key<string>;
  name: string;
}

// After adding a field
interface BasicSchema {
  id: Key<string>;
  name: string;
  createdAt: Date;  // New field
}
```

The Moose framework will:
1. Detect the change when you save the file
2. Update the table schema in the local ClickHouse instance
3. Make the new field immediately available for use

### Verifying Your Tables

You can verify your tables were created correctly using:
```bash
# List all tables in your local environment
moose ls
```

Or by connecting directly to your local ClickHouse instance and running SQL commands.

## Compression Codecs

Specify per-column compression codecs to optimize storage and performance:

```typescript
import { Codec, DateTime, UInt64 } from '@514labs/moose-lib';

interface Metrics {
  // Delta for timestamps and monotonically increasing values
  timestamp: DateTime & ClickHouseCodec<"Delta, LZ4">;

  // Gorilla for floating point sensor data
  temperature: number & ClickHouseCodec<"Gorilla, ZSTD(3)">;

  // DoubleDelta for counters and metrics
  request_count: number & ClickHouseCodec<"DoubleDelta, LZ4">;

  // ZSTD for text/JSON with compression level (1-22)
  log_data: Record<string, any> & ClickHouseCodec<"ZSTD(9)">;
  user_agent: string & ClickHouseCodec<"ZSTD(3)">;

  // Compress array elements
  tags: string[] & ClickHouseCodec<"LZ4">;
  event_ids: UInt64[] & ClickHouseCodec<"ZSTD(1)">;
}

export const MetricsTable = new OlapTable<Metrics>("Metrics", {
  orderByFields: ["timestamp"]
});
```

### Common Codecs
- **Delta/DoubleDelta**: For timestamps, counters, monotonic values
- **Gorilla**: For floating-point sensor data, temperatures, stock prices
- **ZSTD**: General-purpose with levels 1-22 (higher = better compression, slower)
- **LZ4**: Fast decompression, lower CPU usage

### Codec Chains
Combine codecs (processed left-to-right): `Delta, LZ4` or `Gorilla, ZSTD(3)`

### Combining with Other Annotations
```typescript
import { ClickHouseDefault, ClickHouseTTL } from "@514labs/moose-lib";

interface Events {
  // Codec + Default value
  status: string & ClickHouseDefault<"'pending'"> & ClickHouseCodec<"ZSTD(3)">;

  // Codec + TTL
  email: string & ClickHouseTTL<"timestamp + INTERVAL 30 DAY"> & ClickHouseCodec<"ZSTD(3)">;

  // Codec + Numeric type
  event_count: UInt64 & ClickHouseCodec<"DoubleDelta, LZ4">;
}
```
