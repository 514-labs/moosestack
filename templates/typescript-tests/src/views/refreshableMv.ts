import typia from "typia";
import { MaterializedView, OlapTable, sql, DateTime } from "@514labs/moose-lib";
import { BarPipeline } from "../ingest/models";

// ============================================================================
// Refreshable Materialized View E2E Tests
// ============================================================================
// Tests both incremental and refreshable materialized views to ensure the
// new refresh configuration API works correctly end-to-end.

// Target schema for hourly aggregated stats
interface HourlyStats {
  hour: DateTime;
  totalRows: number & typia.tags.Type<"int64">;
  avgTextLength: number;
}

// Target schema for daily stats with refresh
interface DailyStats {
  day: string & typia.tags.Format<"date">;
  rowCount: number & typia.tags.Type<"int64">;
  maxTextLength: number & typia.tags.Type<"int64">;
}

// Target schema for weekly rollup
interface WeeklyRollup {
  weekStart: string & typia.tags.Format<"date">;
  totalRecords: number & typia.tags.Type<"int64">;
}

const barTable = BarPipeline.table!;

// ============================================================================
// Test 1: Refreshable MV with EVERY interval
// ============================================================================
// This MV refreshes every hour, aggregating data from the Bar table

export const HourlyStatsMV = new MaterializedView<HourlyStats>({
  materializedViewName: "HourlyStats_MV",
  targetTable: { name: "HourlyStats" },
  selectStatement: sql`SELECT
    toStartOfHour(${barTable.columns.utcTimestamp}) as hour,
    count(*) as totalRows,
    avg(${barTable.columns.textLength}) as avgTextLength
  FROM ${barTable}
  GROUP BY hour`,
  selectTables: [barTable],
  refreshConfig: {
    interval: { type: "every", value: 1, unit: "hour" },
  },
});

// ============================================================================
// Test 2: Refreshable MV with AFTER interval and offset
// ============================================================================
// This MV refreshes 30 minutes after the last refresh completed,
// with a 5-minute offset from the start of the interval

export const DailyStatsMV = new MaterializedView<DailyStats>({
  materializedViewName: "DailyStats_MV",
  targetTable: { name: "DailyStats" },
  selectStatement: sql`SELECT
    toDate(${barTable.columns.utcTimestamp}) as day,
    count(*) as rowCount,
    max(${barTable.columns.textLength}) as maxTextLength
  FROM ${barTable}
  GROUP BY day`,
  selectTables: [barTable],
  refreshConfig: {
    interval: { type: "after", value: 30, unit: "minute" },
    offset: { value: 5, unit: "minute" },
  },
});

// ============================================================================
// Test 3: Refreshable MV with DEPENDS ON and APPEND
// ============================================================================
// This MV depends on DailyStats_MV and uses APPEND mode for incremental updates

export const WeeklyRollupMV = new MaterializedView<WeeklyRollup>({
  materializedViewName: "WeeklyRollup_MV",
  targetTable: { name: "WeeklyRollup" },
  selectStatement: `SELECT
    toMonday(day) as weekStart,
    sum(rowCount) as totalRecords
  FROM DailyStats
  GROUP BY weekStart`,
  selectTables: [], // Note: source is another MV's target table
  refreshConfig: {
    interval: { type: "every", value: 1, unit: "day" },
    dependsOn: ["DailyStats_MV"],
    append: true,
  },
});

// ============================================================================
// Test 4: Refreshable MV with randomize window
// ============================================================================
// This MV uses randomization to prevent thundering herd on refresh

interface RandomizedStats {
  minute: DateTime;
  eventCount: number & typia.tags.Type<"int64">;
}

export const RandomizedStatsMV = new MaterializedView<RandomizedStats>({
  materializedViewName: "RandomizedStats_MV",
  targetTable: { name: "RandomizedStats" },
  selectStatement: sql`SELECT
    toStartOfMinute(${barTable.columns.utcTimestamp}) as minute,
    count(*) as eventCount
  FROM ${barTable}
  GROUP BY minute`,
  selectTables: [barTable],
  refreshConfig: {
    interval: { type: "every", value: 5, unit: "minute" },
    randomize: { value: 30, unit: "second" },
  },
});

// ============================================================================
// Test 5: Incremental MV (control - no refreshConfig)
// ============================================================================
// This is a traditional incremental MV for comparison - no refreshConfig means
// it triggers on every insert to the source table

interface IncrementalStats {
  primaryKey: string;
  processedAt: DateTime;
  textLengthSquared: number & typia.tags.Type<"int64">;
}

export const IncrementalStatsMV = new MaterializedView<IncrementalStats>({
  materializedViewName: "IncrementalStats_MV",
  targetTable: { name: "IncrementalStats" },
  selectStatement: sql`SELECT
    ${barTable.columns.primaryKey} as primaryKey,
    now() as processedAt,
    ${barTable.columns.textLength} * ${barTable.columns.textLength} as textLengthSquared
  FROM ${barTable}`,
  selectTables: [barTable],
  // No refreshConfig = incremental MV
});
