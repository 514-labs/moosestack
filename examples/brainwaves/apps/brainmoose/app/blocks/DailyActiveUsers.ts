// DMV2 MaterializedView: Calculates the number of daily active users
// based on the number of unique users who complete a sign-in activity each day.

import { MaterializedView } from "@514labs/moose-lib";
import { ParsedActivityPipeline } from "../datamodels/models";

interface DailyActiveUsersData {
  date: Date;
  dailyActiveUsers: string; // AggregateFunction(uniq, String)
}

const parsedActivityTable = ParsedActivityPipeline.table!;

// DMV2 MaterializedView for Daily Active Users
export const DailyActiveUsersMV = new MaterializedView<DailyActiveUsersData>({
  tableName: "DailyActiveUsers",
  materializedViewName: "DailyActiveUsers_mv",
  orderByFields: ["date"],
  selectStatement: `SELECT 
      toStartOfDay(timestamp) as date,
      uniqState(userId) as dailyActiveUsers
  FROM ParsedActivity 
  WHERE activity = 'Login' 
  GROUP BY toStartOfDay(timestamp)
  `,
  selectTables: [parsedActivityTable],
});
