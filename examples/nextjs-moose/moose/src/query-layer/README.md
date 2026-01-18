# Query Layer Module Structure

The query layer is organized by domain, with each module containing related types and functionality.

## Module Organization

### Core Types (`types.ts`)
- `FilterOperator` - Supported filter operators
- `SortDir` - Sort direction (ASC/DESC)
- Re-exports: `SqlValue`, `ColRef`

**Purpose**: Fundamental types used throughout the query building system.

### Fields (`fields.ts`)
- `FieldDef` - Internal runtime field definition (uses ColRef for SQL generation)
- `DimensionDef<TModel, TKey>` - Dimension definition with type-safe string column names (for grouping/filtering)
- `MetricDef` - Metric field definition (aggregates)
- `ModelDimensionDef` - **Deprecated**: Alias for `DimensionDef`, use `DimensionDef` directly

**Purpose**: Defines how columns, expressions, and aggregates are represented. Uses type-safe string column names matching the `ModelFilterDef` pattern.

### Filters (`filters.ts`)
- `FilterDef` - Runtime filter definition (uses ColRef)
- `ModelFilterDef` - Configuration filter definition (uses column names)
- `FilterDefBase` - Base constraint for filter definitions
- `FilterValueType` - Type helper to extract value types

**Purpose**: Filter-related types and utilities for type-safe filtering.

### Query Request (`query-request.ts`)
- `FilterParams` - Type-safe filter parameter structure
- `QueryRequest` - User-facing query request (dimensions/metrics, filters, sorting, pagination)
- `QueryParts` - Individual SQL clauses for custom assembly

**Purpose**: Defines the user-facing structure for query requests with dimensions and metrics.

### Resolved Query Spec (`resolved-query-spec.ts`)
- `ResolvedQuerySpec` - Internal resolved query specification (select/groupBy for SQL execution)

**Purpose**: Internal representation used by query compilation layer. Users should never interact with this type directly.

### Query Mapper (`query-mapper.ts`)
- `QueryMapper` - Interface for mapping custom API request shapes to QueryRequest
- `defineMapper()` - Factory function to create QueryMapper instances (opt-in)
- `toQueryRequest()` - Direct helper for QueryRequest usage (no mapping needed)

**Purpose**: Transform custom API request shapes (e.g., from HTTP requests, forms) into QueryRequest. Use this when you receive data in a different shape than QueryRequest.

**Note**: QueryMapper and QueryBuilder are **alternatives** - use one OR the other, not both. They both produce QueryRequest objects that get resolved and executed.

### Type Helpers (`type-helpers.ts`)
- `Names<T>` - Extract string keys from record types
- `OperatorValueType<Op, TValue>` - Map operators to value types
- `InferDimensionNames<TModel>` - Extract dimension names as union type
- `InferMetricNames<TModel>` - Extract metric names as union type
- `InferRequest<TModel>` - Extract QueryRequest type from model
- `InferResult<TModel>` - Extract result type from model

**Purpose**: Type inference utilities for working with query models.

### Query Model (`query-model.ts`)
- `QueryModelConfig` - Configuration interface for defining models
- `QueryModel` - Main query model interface
- `defineQueryModel()` - Function to create a query model

**Purpose**: Core query building interface and implementation.

### Query Builder (`query-builder.ts`)
- `QueryBuilder` - Fluent builder interface (renamed from ParamBuilder)
- `buildQuery()` - Create a fluent query builder

**Purpose**: Fluent, chainable API for building QueryRequest objects programmatically. Use this when you're building queries dynamically in code.

**Note**: QueryBuilder and QueryMapper are **alternatives** - use one OR the other, not both. They both produce QueryRequest objects that get resolved and executed.

### Utilities (`utils.ts`)
- SQL building functions (eq, ne, gt, etc.)
- SQL clause builders (where, orderBy, groupBy, etc.)
- Aggregation functions (count, sum, avg, etc.)

**Purpose**: Low-level SQL building utilities.

## Usage

### Choosing Between QueryBuilder and QueryMapper

**Use QueryBuilder** when:
- Building queries programmatically in code
- Conditions vary at runtime
- You want a fluent, chainable API
- Example: Dynamic filtering based on user input

**Use QueryMapper** when:
- Receiving data from HTTP requests, forms, or external APIs
- Your API shape differs from QueryRequest structure
- You need to map custom field names to QueryRequest fields
- Example: Mapping `{ statuses: [...] }` to `{ dimensions: [...] }`

**Use QueryRequest directly** when:
- Your API already matches QueryRequest structure
- No transformation needed
- Example: `{ dimensions: [...], metrics: [...] }` already matches

### Import from main index (recommended)
```typescript
import { 
  defineQueryModel, 
  buildQuery,        // Use this OR defineMapper, not both
  defineMapper,      // Use this OR buildQuery, not both
  InferRequest,
  InferDimensionNames,
  InferMetricNames,
} from "./query-layer";
```

### Import from specific modules (for tree-shaking)
```typescript
import { defineQueryModel } from "./query-layer/query-model";
import { buildQuery } from "./query-layer/query-builder";  // OR
import { defineMapper } from "./query-layer/query-mapper";  // OR
import { InferRequest } from "./query-layer/type-helpers";
```

## Architecture: Clear Layering

### Building QueryRequest (Choose One Approach)

You have **two alternative ways** to assemble a QueryRequest:

1. **QueryBuilder** (`buildQuery()`) - Fluent, chainable API for programmatic query building
   ```typescript
   const request = buildQuery(model)
     .dimensions(["status"])
     .metrics(["totalEvents"])
     .filter("status", "eq", "active")
     .build();
   ```

2. **QueryMapper** (`defineMapper()`) - Transform custom API shapes to QueryRequest
   ```typescript
   const mapToQueryRequest = defineMapper<MyApiParams>()(model, {
     statuses: "dimensions",
     measures: "metrics",
     minAmount: ["amount", "gte"],
   });
   const request = mapToQueryRequest(apiParams);
   ```

**Important**: Use **one OR the other**, not both. They both produce the same `QueryRequest` object.

### Query Execution Flow

```
Your Code
  ↓
[QueryBuilder OR QueryMapper] → QueryRequest
  ↓
QueryModel.resolveQuerySpec() → ResolvedQuerySpec (internal)
  ↓
QueryModel.toSql() → SQL Query
  ↓
Execute → Results
```

### Internal Compilation Layer
- **ResolvedQuerySpec** - Internal resolved specification (select/groupBy) - NOT user-facing
- **QueryParts** - SQL clause parts

### Key Principle
**Dimensions and metrics are user-facing concepts. Select and groupBy are internal implementation details.**

- Users specify `dimensions` and `metrics` in `QueryRequest`
- Query compilation automatically derives `select` and `groupBy` internally
- No confusion between semantic concepts and SQL construction

### Backward Compatibility
**Note**: The old `queryModel.ts` file may still exist and re-export everything, so existing imports continue to work:
```typescript
import { defineQueryModel } from "./query-layer/queryModel"; // Still works!
```

## Module Dependencies

```
types.ts (no dependencies)
  ↓
fields.ts → types.ts
filters.ts → types.ts
  ↓
type-helpers.ts → types.ts, filters.ts
query-request.ts → types.ts, filters.ts, type-helpers.ts
resolved-query-spec.ts → types.ts, filters.ts, type-helpers.ts
query-mapper.ts → query-model.ts, query-request.ts
  ↓
query-model.ts → all above modules (uses QueryRequest, resolves to ResolvedQuerySpec internally)
query-builder.ts → query-model.ts, query-request.ts, type-helpers.ts
  ↓
index.ts → exports all modules (except ResolvedQuerySpec - internal only)
```

## Benefits of This Structure

1. **Clear Separation of Concerns**: Each module has a single, well-defined purpose
2. **Better Discoverability**: Easy to find types and functions by their purpose
3. **Improved Maintainability**: Changes to one area don't affect unrelated code
4. **Better Tree-Shaking**: Can import only what you need
5. **Easier Testing**: Can test modules in isolation
6. **Better Documentation**: Each module can have focused documentation
