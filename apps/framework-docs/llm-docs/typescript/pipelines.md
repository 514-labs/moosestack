# Ingest Pipelines

## Overview
Ingest Pipelines in DMv2 provide a unified way to define your data ingestion infrastructure. They combine tables, streams, and ingest APIs into a single configuration.
Use these instead of defining each one individually
## Basic Pipeline Configuration

```typescript
import { IngestPipeline, Key } from '@514labs/moose-lib';

// Define your schema
interface ExampleSchema {
  id: Key<string>;          // Key must specify string as underlying type
  name: string;
  value: number;
}

// Basic pipeline configuration with schema type
export const ExamplePipeline = new IngestPipeline<ExampleSchema>("ExamplePipeline", {
  table: true,      // Creates a basic table
  stream: true,     // Creates a basic stream
  ingestApi: true      // Creates a basic ingest API
});
```

## Pipeline Configuration Options

The `IngestPipeline` class accepts the following configuration options:

```typescript
type DataModelConfigV2<T> = {
  table: boolean | OlapConfig<T>;        // Table configuration
  stream: boolean | Omit<StreamConfig, "destination">;  // Stream configuration
  ingestApi: boolean | Omit<IngestConfig, "destination">;  // Ingest configuration
};
```

### Stream Configuration
```typescript
interface StreamConfig {
  parallelism?: number;           // Number of parallel processing threads
  retentionPeriod?: number;      // Data retention period in seconds
  destination?: OlapTable;       // Optional destination table
}
```

### Ingest Configuration
```typescript
interface IngestConfig {
  destination: Stream;           // Required destination stream
  format?: IngestionFormat;     // Optional ingestion format
}
```

## Pipeline Example

Here's a comprehensive example that demonstrates all available configuration options:

```typescript
// Schema with various field types to demonstrate configuration options
interface ComprehensiveSchema {
  id: Key<string>;          // Required Key field with string type
  timestamp: Date;          // Timestamp for time-series data
  value: number;           
  tags?: string[];          // Optional array of tags
  metadata: {
    source: string;
    priority: number;
  };
}

// Pipeline demonstrating all configuration options
export const ComprehensivePipeline = new IngestPipeline<ComprehensiveSchema>("ComprehensivePipeline", {
  // Table configuration with all options
  table: {
    orderByFields: ["id", "timestamp"],  // Specify sort order
    engine: ClickHouseEngines.ReplacingMergeTree,                   // Enable deduplication
  },

  // Stream configuration with all options
  stream: {
    parallelism: 4,                      // Number of parallel processing threads
    retentionPeriod: 86400,             // 24 hours retention
  },

  // Ingest configuration with all options
  ingest: {
    format: IngestionFormat.JSON,        // Specify ingestion format
  }
});
```

## How It Works

When you create an `IngestPipeline` instance:
1. If `table` is configured:
   - Creates an `OlapTable` with the specified configuration
   - If `table` is `true`, uses default configuration
2. If `stream` is configured:
   - Creates a `Stream` with the specified configuration
   - Automatically connects to the table if one exists
   - If `stream` is `true`, uses default configuration
3. If `ingestApi` is configured:
   - Creates an `IngestApi` with the specified configuration
   - Automatically connects to the stream
   - If `ingestApi` is `true`, uses default configuration
