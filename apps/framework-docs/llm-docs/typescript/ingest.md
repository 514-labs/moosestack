---
title: TypeScript Data Ingestion
description: Ingest data into Moose using HTTP APIs, SDKs, and batch imports with automatic schema validation
priority: 0.90
category: data-ingestion
language: typescript
---

# Ingest

## Overview
The Ingest API provides a type-safe way to create HTTP endpoints that accept data and write it to your streams. It handles validation, error handling, and provides a clean interface for data ingestion.

## Basic Ingest Setup

```typescript
import { IngestApi, Key } from '@514labs/moose-lib';

// Define your schema
interface ExampleSchema {
  id: Key<string>;
  name: string;
  value: number;
}

// Create an ingest endpoint
export const DataIngest = new IngestApi<ExampleSchema>("DataIngest", {
  destination: DataStream,  // The stream to write to
});
```

## Ingest Configuration

The `IngestApi` class accepts the following configuration options:

```typescript
interface IngestConfig {
  destination: Stream;           // Required destination stream
}

```

## Ingest Examples

### Basic Ingest Endpoint
```typescript

import { OlapTable, Stream, IngestApi } from "@514labs/moose-lib"
// Define your schema
interface UserEventSchema {
  id: Key<string>;
  userId: string;
  action: string;
  timestamp: Date;
}

// Create your table and stream
export const UserEvent = new OlapTable<UserEventSchema>("UserEvent", {
  orderByFields: ["id"]
});

export const UserEventStream = new Stream<UserEventSchema>("user-event-stream", {
  destination: UserEvent
});

// Create an ingest endpoint
export const UserEvent = new IngestApi<UserEventSchema>("UserEvent", {
  destination: UserEventStream,
});
```

### Ingest with JSON Array Format
```typescript
// Ingest endpoint for batch ingestion
export const BatchIngest = new IngestApi<UserEventSchema>("BatchIngest", {
  destination: UserEventStream,
});
```

## Data Validation

The Ingest API automatically validates incoming data against your schema:

```typescript
// Valid data
const validEvent = {
  id: "123",
  userId: "user_456",
  action: "login",
  timestamp: new Date()
};

// Invalid data will be rejected with validation errors
const invalidEvent = {
  id: "123",
  // Missing required fields
  action: "login"
};
```

## Error Handling

The Ingest API provides comprehensive error handling:

```typescript
// Example of handling ingest errors
try {
  const response = await fetch("/api/events/user", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(event)
  });

  if (!response.ok) {
    const error = await response.json();
    if (error.code === "VALIDATION_ERROR") {
      // Handle validation errors
      console.error("Invalid data:", error.details);
    } else if (error.code === "STREAM_ERROR") {
      // Handle stream errors
      console.error("Stream error:", error.message);
    } else {
      // Handle other errors
      console.error("Ingest error:", error);
    }
  }
} catch (error) {
  // Handle network or other errors
  console.error("Request failed:", error);
}
```

## Response Format

The Ingest API returns standardized responses:

```typescript
// Success response
{
  success: true,
  data: {
    id: "123",
    timestamp: "2024-03-20T12:00:00Z"
  }
}

// Error response
{
  success: false,
  error: {
    code: "VALIDATION_ERROR",
    message: "Invalid data format",
    details: {
      field: "userId",
      error: "Required field missing"
    }
  }
}
```

## Best Practices

1. **Implement proper error handling**:
   - Handle validation errors gracefully
   - Implement retry logic for transient failures
   - Log errors for debugging

2. **Secure your endpoints**:
   - Use authentication
   - Implement rate limiting
   - Validate input data thoroughly

3. **Monitor ingest performance**:
   - Track request latency
   - Monitor error rates
   - Watch for validation failures

## Monitoring and Debugging

You can monitor your ingest endpoints using various tools:

## Complete Example

Here's a complete example showing how to set up a full ingest pipeline:

```typescript
import { OlapTable, Stream, IngestApi, Key, IngestionFormat } from '@514labs/moose-lib';

// Define your schema
interface AnalyticsEventSchema {
  id: Key<string>;
  eventType: string;
  userId: string;
  timestamp: Date;
  properties: {
    [key: string]: string | number | boolean | null;
  };
}

// Create your table
export const Analytics = new OlapTable<AnalyticsEventSchema>("Analytics", {
  orderByFields: ["id"]
});

// Create your stream
export const AnalyticsStream = new Stream<AnalyticsEventSchema>("analytics-stream", {
  destination: Analytics
});

// Create your ingest endpoint
export const Analytics = new IngestApi<AnalyticsEventSchema>("Analytics", {
  destination: AnalyticsStream,
  format: IngestionFormat.JSON
});

// Example usage
async function trackEvent(event: AnalyticsEventSchema) {
  try {
    const response = await fetch("/api/analytics", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(event)
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("Failed to track event:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Error tracking event:", error);
    return false;
  }
}
``` 