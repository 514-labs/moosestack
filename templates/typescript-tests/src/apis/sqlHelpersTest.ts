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
      sql.fragment`${BA.columns.dayOfMonth}`,
      sql.fragment`${BA.columns.totalRows}`,
    ];
    const selectClause = sql.join(selectColumns, ",");

    // Test sql.raw() - add a raw SQL function
    const timestampCol =
      includeTimestamp ?
        sql.fragment`, ${sql.raw("NOW()")} as query_time`
      : sql.fragment``;

    // Test conditional WHERE clauses
    const conditions: Sql[] = [];
    if (minDay !== undefined) {
      conditions.push(sql.fragment`${BA.columns.dayOfMonth} >= ${minDay}`);
    }
    if (maxDay !== undefined) {
      conditions.push(sql.fragment`${BA.columns.dayOfMonth} <= ${maxDay}`);
    }

    const whereClause =
      conditions.length > 0 ?
        sql.fragment`WHERE ${sql.join(conditions, "AND")}`
      : sql.fragment``;

    // Test Sql.append() - build query incrementally
    const baseQuery = sql.statement`SELECT ${selectClause}${timestampCol} FROM ${BA}`;
    const queryWithWhere = baseQuery.append(sql.fragment` ${whereClause}`);
    const finalQuery = queryWithWhere
      .append(sql.fragment` ORDER BY ${BA.columns.totalRows} DESC`)
      .append(sql.fragment` LIMIT 10`);

    const data = await client.query.execute<ResponseData>(finalQuery);
    return data.json();
  },
);
