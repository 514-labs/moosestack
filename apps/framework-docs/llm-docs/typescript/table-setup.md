# Table Setup

## Overview
Tables in DMv2 are created using the `OlapTable` class, which provides a type-safe way to define your data infrastructure.

## Basic Table Configuration

```typescript
import { OlapTable, Key } from '@514labs/moose-lib';

// Basic table configuration
export const Example = new OlapTable("Example");
```

## Table Configuration Options

The `OlapTable` class supports both a modern discriminated union API and legacy configuration for backward compatibility.

### Modern API (Recommended)

```typescript
// Engine-specific configurations with type safety
type OlapConfig<T> = 
  | { engine: ClickHouseEngines.MergeTree; orderByFields?: (keyof T & string)[]; settings?: { [key: string]: string }; }
  | { 
      engine: ClickHouseEngines.ReplacingMergeTree; 
      orderByFields?: (keyof T & string)[]; 
      ver?: keyof T & string;        // Optional: version column for keeping latest
      isDeleted?: keyof T & string;   // Optional: soft delete marker (requires ver)
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
      orderByFields?: (keyof T & string)[];
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

// Option 1: Direct configuration with new API
export const S3Events = new OlapTable("S3Events", {
  engine: ClickHouseEngines.S3Queue,
  s3Path: "s3://my-bucket/events/*.json",
  format: "JSONEachRow",
  // Optional authentication (omit for public buckets)
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
  orderByFields: ["id", "timestamp"]
});

// Option 2: Using factory method (cleanest approach)
export const S3EventsFactory = OlapTable.withS3Queue<S3EventSchema>(
  "S3Events",
  "s3://my-bucket/events/*.json",
  "JSONEachRow",
  {
    awsAccessKeyId: "AKIA...",
    awsSecretAccessKey: "secret...",
    compression: "gzip",
    settings: {
      mode: "unordered",
      keeper_path: "/clickhouse/s3queue/s3_events"
    },
    orderByFields: ["id", "timestamp"]
  }
);

// Public S3 bucket example (no credentials needed)
export const PublicS3Data = OlapTable.withS3Queue<any>(
  "PublicS3Data",
  "s3://public-bucket/data/*.csv",
  "CSV",
  {
    // No AWS credentials for public buckets
    settings: {
      mode: "ordered",
      keeper_path: "/clickhouse/s3queue/public_data"
    }
  }
);
```

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