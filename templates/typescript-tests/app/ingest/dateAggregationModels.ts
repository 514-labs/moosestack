import { Aggregated, Key, OlapTable } from "@514labs/moose-lib";

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
export const DateAggregatedTypeTestTable =
  new OlapTable<DateAggregatedTypeTest>("DateAggregatedTypeTest");
