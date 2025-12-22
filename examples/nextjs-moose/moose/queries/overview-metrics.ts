import { sql } from "@514labs/moose-lib";
import { Events } from "../models/events";
import { executeQuery } from "../client";

export interface DateRange {
  start: Date;
  end: Date;
}

interface SalesRow {
  total_revenue: number;
  total_sales: number;
}

interface OverviewMetrics {
  totalRevenue: number;
  totalSales: number;
  activeNow: number;
}

export const getOverviewMetrics = async (
  dateRange?: DateRange,
): Promise<OverviewMetrics> => {
  const startDate = dateRange?.start.toISOString().split("T")[0];
  const endDate = dateRange?.end.toISOString().split("T")[0];

  const dateFilter =
    dateRange ?
      sql`AND event_time >= toDate(${startDate!}) AND event_time <= toDate(${endDate!})`
    : sql``;

  const sales = await executeQuery<SalesRow>(
    sql`
      SELECT
        sum(amount) as total_revenue,
        count(*) as total_sales
      FROM ${Events}
      WHERE event_type = 'purchase' ${dateFilter}
    `,
  );

  const activeUsers = await executeQuery<{
    active_users: number;
  }>(sql`
    SELECT uniq(customer_id) as active_users
    FROM ${Events}
    WHERE event_time > now() - interval 1 hour
  `);

  return {
    totalRevenue: sales?.[0]?.total_revenue ?? 0,
    totalSales: sales?.[0]?.total_sales ?? 0,
    activeNow: activeUsers?.[0]?.active_users ?? 0,
  };
};
