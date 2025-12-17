import { sql } from "@514labs/moose-lib";
import { Events } from "../models/events";
import { getMoose } from "../client";

export interface DateRange {
  start: Date;
  end: Date;
}

export const getOverviewMetrics = async (dateRange?: DateRange) => {
  const moose = await getMoose();

  const startDate = dateRange?.start.toISOString().split("T")[0];
  const endDate = dateRange?.end.toISOString().split("T")[0];

  const dateFilter =
    dateRange ?
      sql`AND event_time >= toDate(${startDate!}) AND event_time <= toDate(${endDate!})`
    : sql``;

  const salesData = await moose.client.query.execute(
    sql`
      SELECT
        sum(amount) as total_revenue,
        count(*) as total_sales
      FROM ${Events}
      WHERE event_type = 'purchase' ${dateFilter}
    `,
  );

  const [salesRow] = await salesData.json<{
    total_revenue?: number;
    total_sales?: number;
  }>();

  const activeUsersData = await moose.client.query.execute(
    sql`
      SELECT uniq(customer_id) as active_users
      FROM ${Events}
      WHERE event_time > now() - interval 1 hour
    `,
  );

  const [activeUsersRow] = await activeUsersData.json<{
    active_users?: number;
  }>();

  return {
    totalRevenue: salesRow?.total_revenue ?? 0,
    totalSales: salesRow?.total_sales ?? 0,
    activeNow: activeUsersRow?.active_users ?? 0,
  };
};
