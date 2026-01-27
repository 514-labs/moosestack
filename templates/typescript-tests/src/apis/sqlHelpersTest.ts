import { Api, Sql } from "@514labs/moose-lib";
import { BarAggregatedMV } from "../views/barAggregated";

/**
 * Test API for the new sql.join(), sql.raw(), and Sql.append() helpers.
 */

interface QueryParams {
  minDay?: number;
  maxDay?: number;
  includeTimestamp?: boolean;
}

interface ResponseData {
  [key: string]: unknown;
}

export const SqlHelpersTestApi = new Api<QueryParams, ResponseData[]>(
  "sql-helpers-test",
  async (params, { client, sql }) => {
    const { minDay, maxDay, includeTimestamp } = params;

    const BA = BarAggregatedMV.targetTable;
    // Test sql.join() - join column names
    const selectColumns: Sql[] = [
      sql`${BA.columns.dayOfMonth}`,
      sql`${BA.columns.totalRows}`,
    ];
    const selectClause = sql.join(selectColumns, ",");

    // Test sql.raw() - add a raw SQL function
    const timestampCol =
      includeTimestamp ? sql`, ${sql.raw("NOW()")} as query_time` : sql``;

    // Test conditional WHERE clauses
    const conditions: Sql[] = [];
    if (minDay !== undefined) {
      conditions.push(sql`${BA.columns.dayOfMonth} >= ${minDay}`);
    }
    if (maxDay !== undefined) {
      conditions.push(sql`${BA.columns.dayOfMonth} <= ${maxDay}`);
    }

    const whereClause =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, "AND")}` : sql``;

    // Test Sql.append() - build query incrementally
    const baseQuery = sql`SELECT ${selectClause}${timestampCol} FROM ${BA}`;
    const queryWithWhere = baseQuery.append(sql` ${whereClause}`);
    const finalQuery = queryWithWhere
      .append(sql` ORDER BY ${BA.columns.totalRows} DESC`)
      .append(sql` LIMIT 10`);

    const data = await client.query.execute<ResponseData>(finalQuery);
    return data.json();
  },
);
