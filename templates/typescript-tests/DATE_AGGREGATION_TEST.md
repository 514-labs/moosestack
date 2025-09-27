# Date & Aggregated Type Test

This template includes a test case for **ENG-845**: Date & Aggregated<"argMax", [Date, Date]> type combination.

## Test Files

- **`app/ingest/dateAggregationModels.ts`**: Defines models for testing Date & Aggregated types
  - `DateAggregationRaw`: Raw data model for ingestion (without Aggregated types)
  - `DateAggregationTest`: Table model with `Date & Aggregated<"argMax", [Date, Date]>` type
- **`app/views/dateAggregationView.ts`**: Creates a materialized view that uses the aggregated date field
- **`app/workflows/dateAggregationGenerator.ts`**: Generates test data for the date aggregation functionality

## What This Tests

The critical test case is in `dateAggregationModels.ts`:

```typescript
export interface DateAggregationTest {
  id: Key<string>;
  // This is the critical test case: Date & Aggregated<"argMax", [Date, Date]>
  // Before the fix, this would cause TypeScript compilation errors
  // After the fix, Date arguments should be normalized to DateTime for consistency
  lastUpdated: Date & Aggregated<"argMax", [Date, Date]>;
  value: number;
  category: string;
}
```

## Architecture

The test uses a proper MooseStack architecture:

1. **Raw Ingestion**: `DateAggregationRaw` interface for ingesting data via API
2. **Table Schema**: `DateAggregationTest` interface with `Date & Aggregated` type for ClickHouse table
3. **Materialized View**: Uses the table schema to test argMax aggregation on Date fields
4. **Data Generation**: Workflow publishes raw data that gets processed into the table

## Expected Behavior

1. **TypeScript Compilation**: The `Date & Aggregated<"argMax", [Date, Date]>` type should compile without errors
2. **Type Conversion**: JavaScript `Date` types in aggregated function arguments should be normalized to `DateTime` for consistency
3. **Runtime Functionality**: The argMax aggregation should work correctly with Date fields

## Verification

This test was verified by:
1. Creating the table model with the problematic type combination
2. Building the TypeScript code successfully
3. Running end-to-end tests to confirm runtime functionality
4. Confirming that the type conversion logic in `typeConvert.ts` handles this case correctly

The fix ensures that `Date` types are consistently mapped to `DateTime` in both regular and aggregation contexts, while preserving explicit `DateTime`/`DateTime64` aliases.