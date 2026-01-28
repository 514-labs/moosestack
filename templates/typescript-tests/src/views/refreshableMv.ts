import typia from "typia";
import {
  RefreshableMaterializedView,
  MaterializedView,
  sql,
  DateTime,
} from "@514labs/moose-lib";
import { BarPipeline } from "../ingest/models";

// ============================================================================
// Refreshable Materialized View E2E Tests
// ============================================================================
// Tests both incremental and refreshable materialized views to ensure the
// new refresh configuration API works correctly end-to-end.

const barTable = BarPipeline.table!;
const barColumns = barTable.columns;

// ============================================================================
// Test 1: Refreshable MV with EVERY interval
// ============================================================================
// This MV refreshes every hour, aggregating data from the Bar table

interface HourlyStats {
  hour: DateTime;
  totalRows: number & typia.tags.Type<"int64">;
  avgTextLength: number;
}

export const HourlyStatsMV = new RefreshableMaterializedView<HourlyStats>({
  materializedViewName: "HourlyStats_MV",
  targetTable: {
    name: "HourlyStats",
    orderByFields: ["hour"],
  },
  selectStatement: sql`SELECT
    toStartOfHour(${barColumns.utcTimestamp}) as hour,
    count(*) as totalRows,
    avg(${barColumns.textLength}) as avgTextLength
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

interface DailyStats {
  day: string & typia.tags.Format<"date">;
  rowCount: number & typia.tags.Type<"int64">;
  maxTextLength: number & typia.tags.Type<"int64">;
}

export const DailyStatsMV = new RefreshableMaterializedView<DailyStats>({
  materializedViewName: "DailyStats_MV",
  targetTable: {
    name: "DailyStats",
    orderByFields: ["day"],
  },
  selectStatement: sql`SELECT
    toDate(${barColumns.utcTimestamp}) as day,
    count(*) as rowCount,
    max(${barColumns.textLength}) as maxTextLength
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

interface WeeklyRollup {
  weekStart: string & typia.tags.Format<"date">;
  totalRecords: number & typia.tags.Type<"int64">;
}

export const WeeklyRollupMV = new RefreshableMaterializedView<WeeklyRollup>({
  materializedViewName: "WeeklyRollup_MV",
  targetTable: {
    name: "WeeklyRollup",
    orderByFields: ["weekStart"],
  },
  selectStatement: `SELECT
    toMonday(day) as weekStart,
    sum(rowCount) as totalRecords
  FROM DailyStats
  GROUP BY weekStart`,
  selectTables: [DailyStatsMV.targetTable],
  refreshConfig: {
    interval: { type: "every", value: 1, unit: "day" },
    dependsOn: [DailyStatsMV],
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

export const RandomizedStatsMV =
  new RefreshableMaterializedView<RandomizedStats>({
    materializedViewName: "RandomizedStats_MV",
    targetTable: {
      name: "RandomizedStats",
      orderByFields: ["minute"],
    },
    selectStatement: sql`SELECT
    toStartOfMinute(${barColumns.utcTimestamp}) as minute,
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
// This is a traditional incremental MV for comparison - triggers on every
// insert to the source table (no refreshConfig means incremental behavior)

interface IncrementalStats {
  primaryKey: string;
  processedAt: DateTime;
  textLengthSquared: number & typia.tags.Type<"int64">;
}

export const IncrementalStatsMV = new MaterializedView<IncrementalStats>({
  materializedViewName: "IncrementalStats_MV",
  tableName: "IncrementalStats",
  orderByFields: ["primaryKey"],
  selectStatement: sql`SELECT
    ${barColumns.primaryKey} as primaryKey,
    now() as processedAt,
    ${barColumns.textLength} * ${barColumns.textLength} as textLengthSquared
  FROM ${barTable}`,
  selectTables: [barTable],
  // No refreshConfig = incremental MV
});
