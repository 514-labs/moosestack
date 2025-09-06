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
  | { engine: ClickHouseEngines.MergeTree; orderByFields?: (keyof T & string)[]; }
  | { engine: ClickHouseEngines.ReplacingMergeTree; orderByFields?: (keyof T & string)[]; }
  | { 
      engine: ClickHouseEngines.S3Queue;
      s3Path: string;        // S3 bucket path
      format: string;        // Data format
      awsAccessKeyId?: string;
      awsSecretAccessKey?: string;
      orderByFields?: (keyof T & string)[];
      s3Settings?: { ... };  // S3Queue-specific settings
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
  orderByFields: ["id", "version", "updatedAt"]  // Key field must be first
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
  // Engine-specific settings
  s3Settings: {
    mode: "unordered",  // or "ordered" for sequential processing
    keeper_path: "/clickhouse/s3queue/s3_events",
    s3queue_loading_retries: 3,
    s3queue_processing_threads_num: 4,
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
    s3Settings: {
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
    s3Settings: {
      mode: "ordered",
      keeper_path: "/clickhouse/s3queue/public_data"
    }
  }
);
```

#### Legacy API (Still Supported)

```typescript
// Legacy configuration format (will show deprecation warning)
export const S3EventsLegacy = new OlapTable("S3Events", {
  engine: ClickHouseEngines.S3Queue,
  s3QueueEngineConfig: {
    path: "s3://my-bucket/events/*.json",
    format: "JSONEachRow",
    aws_access_key_id: "AKIA...",
    aws_secret_access_key: "secret...",
    compression: "gzip",
    settings: {
      mode: "unordered",
      keeper_path: "/clickhouse/s3queue/s3_events",
      s3queue_loading_retries: 3
    }
  }
});
```

#### S3Queue Configuration Options

```typescript
interface S3QueueEngineConfig {
  path: string;                    // S3 path pattern (e.g., 's3://bucket/data/*.json')
  format: string;                  // Data format (e.g., 'JSONEachRow', 'CSV', 'Parquet')
  aws_access_key_id?: string;      // AWS access key or 'NOSIGN' for public buckets
  aws_secret_access_key?: string;  // AWS secret key (paired with access key)
  compression?: string;            // Optional: 'gzip', 'brotli', 'xz', 'zstd', etc.
  headers?: { [key: string]: string }; // Optional: custom HTTP headers
  settings?: {
    mode?: "ordered" | "unordered";           // Processing mode
    keeper_path?: string;                      // ZooKeeper/Keeper path for coordination
    s3queue_loading_retries?: number;         // Number of retry attempts
    s3queue_processing_threads_num?: number;  // Number of processing threads
    s3queue_polling_min_timeout_ms?: number;  // Min polling timeout
    s3queue_polling_max_timeout_ms?: number;  // Max polling timeout
    s3queue_polling_backoff_ms?: number;      // Polling backoff
    s3queue_track_processed_files?: boolean;  // Track processed files
    s3queue_cleanup_interval_min_age?: number; // Cleanup interval min age
    s3queue_cleanup_interval_max_age?: number; // Cleanup interval max age
    s3queue_total_max_retries?: number;       // Total max retries
    s3queue_max_processed_files_before_commit?: number; // Max files before commit
    s3queue_max_processed_rows_before_commit?: number;  // Max rows before commit
    s3queue_max_processed_bytes_before_commit?: number; // Max bytes before commit
    [key: string]: any;                       // Additional settings
  };
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