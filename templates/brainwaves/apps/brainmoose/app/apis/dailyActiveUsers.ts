// DMV2 Api: Serves the daily active users materialized view
import { Api } from "@514labs/moose-lib";

interface QueryParams {
  limit?: string;
  minDailyActiveUsers?: string;
}

interface DailyActiveUsersResponse {
  date: string;
  dailyActiveUsers: number;
}

export const dailyActiveUsersApi = new Api<
  QueryParams,
  DailyActiveUsersResponse[]
>(
  "daily-active-users",
  async ({ limit = "10", minDailyActiveUsers = "0" }, { client, sql }) => {
    const result = await client.query.execute(
      sql`SELECT 
        date,
        uniqMerge(dailyActiveUsers) as dailyActiveUsers
      FROM DailyActiveUsers
      GROUP BY date 
      HAVING dailyActiveUsers >= ${parseInt(minDailyActiveUsers)}
      ORDER BY date 
      LIMIT ${parseInt(limit)}`,
    );
    return await result.json();
  },
);
