import { Api } from "@514labs/moose-lib";
import { DateAggregationSummaryMV } from "../views/dateAggregationView";
import { tags } from "typia";

// Query parameters for Date aggregation API
interface DateAggregationQueryParams {
  category?: string;
  limit?: number & tags.Type<"int32">;
  orderBy?: "totalRecords" | "avgValue" | "category";
}

// Response data structure
interface DateAggregationResponseData {
  category: string;
  totalRecords: number;
  avgValue: number;
  mostRecentUpdate: Date;
}

/**
 * API endpoint for querying Date aggregation summary data
 * This tests that Date & Aggregated types work correctly in consumption APIs
 */
export const DateAggregationApi = new Api<
  DateAggregationQueryParams,
  DateAggregationResponseData[]
>(
  "dateAggregation",
  async (
    { category, limit = 10, orderBy = "totalRecords" },
    { client, sql },
  ) => {
    const query =
      category ?
        sql`
        SELECT 
          ${DateAggregationSummaryMV.targetTable.columns.category},
          ${DateAggregationSummaryMV.targetTable.columns.totalRecords},
          ${DateAggregationSummaryMV.targetTable.columns.avgValue},
          ${DateAggregationSummaryMV.targetTable.columns.mostRecentUpdate}
        FROM ${DateAggregationSummaryMV.targetTable}
        WHERE ${DateAggregationSummaryMV.targetTable.columns.category} = ${category}
        ORDER BY ${DateAggregationSummaryMV.targetTable.columns[orderBy]} DESC
        LIMIT ${limit}
      `
      : sql`
        SELECT 
          ${DateAggregationSummaryMV.targetTable.columns.category},
          ${DateAggregationSummaryMV.targetTable.columns.totalRecords},
          ${DateAggregationSummaryMV.targetTable.columns.avgValue},
          ${DateAggregationSummaryMV.targetTable.columns.mostRecentUpdate}
        FROM ${DateAggregationSummaryMV.targetTable}
        ORDER BY ${DateAggregationSummaryMV.targetTable.columns[orderBy]} DESC
        LIMIT ${limit}
      `;

    const data = await client.query.execute<DateAggregationResponseData>(query);
    const result: DateAggregationResponseData[] = await data.json();

    return result;
  },
);
