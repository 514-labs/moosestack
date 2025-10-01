import { IngestPipeline, Key, Aggregated, OlapTable } from "@514labs/moose-lib";

/**
 * Data model for testing Date & Aggregated type combination
 * This tests the fix for ENG-845: Date & Aggregated<"argMax", [Date, Date]> type combination
 */
export interface DateAggregationTest {
  id: Key<string>;
  lastUpdated: Date;
  value: number;
  category: string;
}

/**
 * Type-only interface to test Date & Aggregated compilation
 * This is the critical test case: Date & Aggregated<"argMax", [Date, Date]>
 * Before the fix, this would cause TypeScript compilation errors
 * After the fix, Date arguments should be normalized to DateTime for consistency
 */
export interface DateAggregatedTypeTest {
  id: Key<string>;
  // This is the critical test - it should compile without TypeScript errors
  lastUpdated: Date & Aggregated<"argMax", [Date, Date]>;
  value: number;
  category: string;
}

/** Pipeline for testing Date aggregation functionality */
export const DateAggregationPipeline = new IngestPipeline<DateAggregationTest>(
  "DateAggregationTest",
  {
    table: true, // Persist in ClickHouse table
    stream: true, // Buffer records
    ingestApi: true, // POST /ingest/DateAggregationTest
  },
);

/** Pipeline for testing Date aggregation functionality */
export const DateAggregatedTypeTestTable =
  new OlapTable<DateAggregatedTypeTest>("DateAggregatedTypeTest");
