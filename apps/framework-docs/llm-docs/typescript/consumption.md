---
title: TypeScript Analytics APIs
description: Build type-safe analytics APIs for querying ClickHouse with automatic endpoint generation and query optimization
priority: 0.90
category: data-consumption
language: typescript
---

# Analytics APIs

## Overview
Analytics APIs provide a type-safe way to query and transform data from your tables. They allow you to create custom endpoints that can perform complex queries, transformations, and data processing.

## Basic Analytics API Setup

```typescript
import { Api } from '@514labs/moose-lib';
import { tags } from "typia";

// Define your parameter interface with Typia tags for validation
interface QueryParams {
  userId: string & tags.Format<"uuid">;  // Must be a valid UUID
  startDate: Date;
  endDate: Date;
  limit?: number & tags.Type<"int64"> & tags.Minimum<1> & tags.Maximum<100>;
}

// Create a analytics API
export const UserAnalyticsApi = new Api<QueryParams>(
  "user-analytics",
  async (params, utils) => {
    const { client, sql } = utils;
    
    // Use the SQL helper for type-safe queries
    const result = await client.query.execute(sql`
      SELECT 
        user_id,
        COUNT(*) as event_count,
        SUM(value) as total_value
      FROM events
      WHERE user_id = ${params.userId}
        AND timestamp BETWEEN ${params.startDate} AND ${params.endDate}
      GROUP BY user_id
      LIMIT ${params.limit ?? 10}
    `);

    // For simple queries with no type transformations needed,
    // we can return the ResultSet directly
    return result;
  }
);
```

## Parameter Validation with Typia

Typia provides powerful type validation capabilities for your query parameters. Here are some common use cases:

```typescript
import { tags } from "typia";

interface ValidatedParams {
  // String validations
  email: string & tags.Format<"email">;
  uuid: string & tags.Format<"uuid">;
  url: string & tags.Format<"url">;
  
  // Number validations
  positiveInt: number & tags.Type<"int64"> & tags.Minimum<1>;
  percentage: number & tags.Type<"int64"> & tags.Minimum<0> & tags.Maximum<100>;
  
  // Date validations
  futureDate: Date & tags.ExclusiveMinimum<Date.now()>;
  
  // Enum-like validations
  status: "active" | "inactive" | "pending";
  
  // Optional fields with validation
  optionalLimit?: number & tags.Type<"int64"> & tags.Minimum<1>;
}
```

## Available Utilities

The `ApiUtil` object provides several helpful utilities:

```typescript
interface ApiUtil {
  client: MooseClient;  // Query client for database access
  sql: Sql;            // SQL template literal helper
  jwt?: any;           // JWT payload if authentication is enabled
}
```

### SQL Helper

The `sql` template literal helper provides type-safe SQL query construction. For dynamic column or table names, use the `ApiHelpers`:

```typescript
import { ApiHelpers as AH } from "@514labs/moose-lib";

// Use static strings directly - no need for ApiHelpers
const staticQuery = sql`
  SELECT *
  FROM events
  WHERE user_id = ${userId}
`;

// Example of dynamic column ordering and filtering
interface DynamicQueryParams {
  columns: Array<"user_id" | "timestamp" | "event_type" | "value">;
  filters: Array<{
    column: "user_id" | "timestamp" | "event_type" | "value";
    operator: "=" | ">" | "<" | ">=" | "<=" | "!=" | "LIKE";
    value: string | number | Date;
  }>;
  orderBy?: {
    column: "user_id" | "timestamp" | "event_type" | "value";
    direction: "ASC" | "DESC";
  };
}

export const DynamicQueryApi = new Api<DynamicQueryParams>(
  "dynamic-query",
  async (params, utils) => {
    const { client, sql } = utils;
    
    // Build dynamic column list
    const columnList = params.columns.map(col => AH.column(col)).join(", ");
    
    // Build dynamic filters
    const filterConditions = params.filters.map(filter => 
      sql`${AH.column(filter.column)} ${filter.operator} ${filter.value}`
    );
    
    // Build dynamic order by
    const orderByClause = params.orderBy 
      ? sql`ORDER BY ${AH.column(params.orderBy.column)} ${params.orderBy.direction}`
      : sql``;

    // Join filter conditions with AND
    const whereClause = filterConditions.length > 0
      ? sql`WHERE ${filterConditions.reduce((acc, curr, idx) => 
          idx === 0 ? curr : sql`${acc} AND ${curr}`
        )}`
      : sql``;

    return await client.query.execute(sql`
      SELECT ${sql`${columnList}`}
      FROM events
      ${whereClause}
      ${orderByClause}
    `);

  }
);
```

### Query Client

The `MooseClient` provides methods for executing queries and managing workflows:

```typescript
// Execute a query and handle the ResultSet
const result = await client.query.execute(sql`...`);
const data = await result.json(); // Process the data if needed

// Start a workflow
const workflow = await client.workflow.execute("workflow-name", inputData);
```

## Examples

### Basic Query API with Validation
```typescript
import { tags } from "typia";

interface SimpleQueryParams {
  limit: number & tags.Type<"int64"> & tags.Minimum<1> & tags.Maximum<100>;
  offset?: number & tags.Type<"int64"> & tags.Minimum<0>;
}

export const RecentEventsApi = new Api<SimpleQueryParams>(
  "recent-events",
  async (params, utils) => {
    const { client, sql } = utils;
    
    // For simple queries that don't need type transformations,
    // we can return the ResultSet directly
    return await client.query.execute(sql`
      SELECT *
      FROM events
      ORDER BY timestamp DESC
      LIMIT ${params.limit}
      OFFSET ${params.offset ?? 0}
    `);
  }
);
```

## Complete Example

Here's a complete example showing how to set up a full analytics API with Typia validation:

```typescript
import { Api, Sql } from '@514labs/moose-lib';
import { tags } from "typia";

// Define your parameter interface with Typia validation
interface UserMetricsParams {
  userId: string & tags.Format<"uuid">;
  startDate: Date;
  endDate: Date & tags.ExclusiveMinimum<Date.now()>;
  metrics: {
    count?: boolean;
    sum?: boolean;
    avg?: boolean;
  };
  limit?: number & tags.Type<"int64"> & tags.Minimum<1> & tags.Maximum<100>;
}

// Create an analytics API
export const UserMetricsApi = new Api<UserMetricsParams>(
  "user-metrics",
  async (params, utils) => {
    const { client, sql } = utils;
    
    // Build dynamic query based on requested metrics
    const metricQueries: Sql = [];
    if (params.metrics.count) {
      metricQueries.push(sql`COUNT(*) as event_count`);
    }
    if (params.metrics.sum) {
      metricQueries.push(sql`SUM(value) as total_value`);
    }
    if (params.metrics.avg) {
      metricQueries.push(sql`AVG(value) as average_value`);
    }

    // Execute the query
    return await client.query.execute(sql`
      SELECT 
        user_id,
        ${sql.join(metricQueries, ",")}
      FROM events
      WHERE user_id = ${params.userId}
        AND timestamp BETWEEN ${params.startDate} AND ${params.endDate}
      GROUP BY user_id
      LIMIT ${params.limit ?? 10}
    `);

  }
);

// Example usage
async function getUserMetrics(userId: string) {
  const params: UserMetricsParams = {
    userId,
    startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
    endDate: new Date(),
    metrics: {
      count: true,
      sum: true,
      avg: true
    },
    limit: 50
  };

  try {
    const response = await fetch("/api/user-metrics", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("Failed to get user metrics:", error);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("Error getting user metrics:", error);
    return null;
  }
}
``` 