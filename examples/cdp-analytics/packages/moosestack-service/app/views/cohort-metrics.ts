/**
 * Cohort Metrics Materialized View
 *
 * Pre-aggregates customer journey metrics by weekly cohort.
 * ClickHouse updates this automatically when new data arrives.
 */

import {
  MaterializedView,
  ClickHouseEngines,
  sql,
  getTable,
} from "@514labs/moose-lib";

// Get references to existing tables created by IngestPipeline
const customerTable = getTable("Customer");
const sessionTable = getTable("Session");

if (!customerTable || !sessionTable) {
  throw new Error(
    "Required tables Customer and/or Session not found. Ensure models are defined in ingest/models.ts",
  );
}

/**
 * Pre-aggregated cohort metrics for fast dashboard queries.
 * Updated automatically by ClickHouse on each insert.
 */
export interface CohortMetrics {
  /** Week the cohort was created (Monday of that week) */
  cohortWeek: Date;
  /** Number of customers in this cohort */
  cohortSize: number;
  /** Customers with 2+ sessions */
  engagedUsers: number;
  /** Customers with 10+ page views */
  activeUsers: number;
  /** Customers who converted */
  convertedUsers: number;
  /** Total revenue from this cohort */
  totalRevenue: number;
}

/**
 * Materialized view that aggregates customer journey metrics by cohort week.
 *
 * Uses SummingMergeTree because all metrics are additive counts/sums.
 * ClickHouse automatically updates this when new customers or sessions are inserted.
 */
export const cohortMetricsView = new MaterializedView<CohortMetrics>({
  selectStatement: sql`
    WITH customer_metrics AS (
      SELECT
        c.customerId,
        toStartOfWeek(c.createdAt) as cohortWeek,
        count(DISTINCT s.sessionId) as sessionCount,
        sum(s.pageViewCount) as totalPageViews,
        max(s.hasConversion) as hasConversion,
        sum(s.conversionValue) as conversionValue
      FROM ${customerTable} c
      LEFT JOIN ${sessionTable} s ON c.customerId = s.customerId
      GROUP BY c.customerId, cohortWeek
    )
    SELECT
      cohortWeek,
      count(*) as cohortSize,
      countIf(sessionCount >= 2) as engagedUsers,
      countIf(totalPageViews >= 10) as activeUsers,
      countIf(hasConversion = true) as convertedUsers,
      sum(conversionValue) as totalRevenue
    FROM customer_metrics
    GROUP BY cohortWeek
  `,
  selectTables: [customerTable, sessionTable],
  targetTable: {
    name: "CohortMetrics",
    engine: ClickHouseEngines.SummingMergeTree,
    orderByFields: ["cohortWeek"],
  },
  materializedViewName: "mv_cohort_metrics",
});
