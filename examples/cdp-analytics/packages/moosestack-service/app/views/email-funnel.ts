/**
 * Email Acquisition Funnel Materialized View
 *
 * Tracks customers acquired via email channel through their journey:
 * Email Acquired → First Visit → Engaged → Converted
 */

import {
  MaterializedView,
  ClickHouseEngines,
  sql,
  getTable,
} from "@514labs/moose-lib";

const customerTable = getTable("Customer");
const sessionTable = getTable("Session");

if (!customerTable || !sessionTable) {
  throw new Error(
    "Required tables Customer and/or Session not found. Ensure models are defined in ingest/models.ts",
  );
}

/**
 * Pre-aggregated funnel metrics for email-acquired customers.
 */
export interface EmailFunnelMetrics {
  /** Total customers acquired via email channel */
  emailAcquired: number;
  /** Customers with at least one session */
  firstVisit: number;
  /** Customers with 2+ sessions */
  engaged: number;
  /** Customers who converted */
  converted: number;
}

/**
 * Materialized view aggregating email acquisition funnel.
 *
 * Stages:
 * 1. Email Acquired - customers where acquisitionChannel = 'email'
 * 2. First Visit - email customers with at least 1 session
 * 3. Engaged - email customers with 2+ sessions
 * 4. Converted - email customers with a conversion
 */
export const emailFunnelView = new MaterializedView<EmailFunnelMetrics>({
  selectStatement: sql`
    WITH email_customers AS (
      SELECT
        c.customerId,
        count(DISTINCT s.sessionId) as sessionCount,
        max(s.hasConversion) as hasConversion
      FROM ${customerTable} c
      LEFT JOIN ${sessionTable} s ON c.customerId = s.customerId
      WHERE c.acquisitionChannel = 'email'
      GROUP BY c.customerId
    )
    SELECT
      count(*) as emailAcquired,
      countIf(sessionCount >= 1) as firstVisit,
      countIf(sessionCount >= 2) as engaged,
      countIf(hasConversion = true) as converted
    FROM email_customers
  `,
  selectTables: [customerTable, sessionTable],
  targetTable: {
    name: "EmailFunnelMetrics",
    engine: ClickHouseEngines.SummingMergeTree,
    orderByFields: ["emailAcquired"],
  },
  materializedViewName: "mv_email_funnel",
});
