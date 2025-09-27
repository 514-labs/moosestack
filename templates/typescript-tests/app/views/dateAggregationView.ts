import typia from "typia";
import { MaterializedView, sql } from "@514labs/moose-lib";
import { DateAggregationPipeline } from "../ingest/dateAggregationModels";

/**
 * Aggregated view that tests Date aggregation functionality
 * This view demonstrates that Date fields work correctly with argMax aggregation
 */
interface DateAggregationSummary {
  category: string;
  totalRecords: number & typia.tags.Type<"int64">;
  avgValue: number;
  // Test that argMax works correctly with Date fields
  mostRecentUpdate: Date;
}

const dateAggregationTable = DateAggregationPipeline.table!;
const columns = dateAggregationTable.columns;

export const DateAggregationSummaryMV = new MaterializedView<DateAggregationSummary>({
  tableName: "DateAggregationSummary",
  materializedViewName: "DateAggregationSummary_MV",
  orderByFields: ["category"],
  selectStatement: sql`SELECT
    ${columns.category} as category,
    count(*) as totalRecords,
    avg(${columns.value}) as avgValue,
    argMax(${columns.lastUpdated}, ${columns.lastUpdated}) as mostRecentUpdate
  FROM ${dateAggregationTable}
  GROUP BY ${columns.category}
  `,
  selectTables: [dateAggregationTable],
});