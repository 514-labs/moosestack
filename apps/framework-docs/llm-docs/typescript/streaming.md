---
title: TypeScript Streaming
description: Process real-time data streams with Kafka/Redpanda integration and message handling
priority: 0.75
category: streaming
language: typescript
---

# Streaming

## Overview
Streams serve as the data transport layer between your data sources and `OlapTables`. They provide a reliable, high-throughput mechanism for transforming and delivering data to your tables.

## Core Functionality

- **Type-safe data streaming**: Streams use your TypeScript schema to validate incoming data
- **Data transformation**: Transform data before it reaches its destination
- **Type-safe transformations**: Maintain type safety throughout the transformation pipeline

## Creating a Stream

```typescript
import { Stream } from '@514labs/moose-lib';

// Basic stream configuration
export const BasicStream = new Stream<InputSchema>("basic-stream", {
  destination: BasicTable
});
```

## Stream Configuration

The `Stream` class accepts the following configuration:

```typescript
interface StreamConfig {
  destination?: OlapTable;       // Optional destination table
  parallelism?: number;         // Number of parallel processing threads
  retentionPeriod?: number;    // Data retention period in seconds
}
```

## Stream Transformations

Streams support data transformations using the `addTransform` method:

```typescript
interface InputSchema {
  id: Key<string>;
  rawData: string;
  timestamp: Date;
}

interface OutputSchema {
  id: Key<string>;
  processedData: number;
  timestamp: Date;
}

// Create tables and streams
const Raw = new OlapTable<InputSchema>("Raw", {
  orderByFields: ["id"]
});

const Processed = new OlapTable<OutputSchema>("Processed", {
  orderByFields: ["id"]
});

const RawStream = new Stream<InputSchema>("raw-stream", {
  destination: Raw
});

const ProcessedStream = new Stream<OutputSchema>("processed-stream", {
  destination: Processed
});

// Add transformation
RawStream.addTransform(
  ProcessedStream,
  (record: InputSchema) => ({
    id: record.id,
    processedData: parseFloat(record.rawData),
    timestamp: record.timestamp
  })
);
```

### Transform Return Types

The transform function can return:
- A single record
- An array of records
- `undefined` to filter out records
- A Promise of any of the above

```typescript
// Transform returning multiple records
stream1.addTransform(stream2, (record) => {
  return [
    { id: record.id + "-1", value: record.value * 2 },
    { id: record.id + "-2", value: record.value * 3 }
  ];
});

// Transform filtering records
stream1.addTransform(stream2, (record) => {
  if (record.value > 100) {
    return record;
  }
  return undefined; // Filter out records with value <= 100
});

// Async transform
stream1.addTransform(stream2, async (record) => {
  const result = await someAsyncProcessing(record);
  return result;
});
```

## Best Practices

1. **Keep transformations pure**:
   - Avoid side effects in transform functions
   - Make transforms deterministic
   - Handle errors gracefully

2. **Use type parameters**:
   - Specify input and output types for type safety
   - Let TypeScript validate your transformations
   - Catch type errors at compile time

3. **Chain transformations carefully**:
   - Consider the order of transformations
   - Avoid circular dependencies
   - Keep transformation chains simple

## Stream Lifecycle

1. **Creation**: Stream is created with configuration
2. **Validation**: Incoming data is validated against schema
3. **Buffering**: Valid data is buffered for delivery
4. **Delivery**: Data is written to target table
5. **Cleanup**: Old data is removed based on retention policy

## Error Handling

Streams provide built-in error handling mechanisms:

```typescript
// Example of handling stream errors
try {
  await stream.write(event);
} catch (error) {
  if (error instanceof ValidationError) {
    // Handle schema validation errors
    console.error("Invalid data:", error.details);
  } else if (error instanceof BackpressureError) {
    // Handle backpressure situations
    console.warn("Stream is experiencing backpressure");
  } else {
    // Handle other errors
    console.error("Stream error:", error);
  }
}
```

## Monitoring and Debugging

You can monitor your streams using various tools:

```typescript
// Get stream metrics
const metrics = await stream.getMetrics();
console.log("Stream metrics:", metrics);

// Check stream health
const health = await stream.getHealth();
console.log("Stream health:", health);

// Get validation statistics
const validationStats = await stream.getValidationStats();
console.log("Validation statistics:", validationStats);
``` 