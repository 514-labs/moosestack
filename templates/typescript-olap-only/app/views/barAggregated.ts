import typia from "typia";
import { MaterializedView, sql } from "@514labs/moose-lib";
import { BarTable } from "../ingest/models";

interface BarAggregated {
  dayOfMonth: number & typia.tags.Type<"int64">;
  totalRows: number & typia.tags.Type<"int64">;
  rowsWithText: number & typia.tags.Type<"int64">;
  totalTextLength: number & typia.tags.Type<"int64">;
  maxTextLength: number & typia.tags.Type<"int64">;
}

const barColumns = BarTable.columns;

export const BarAggregatedMV = new MaterializedView<BarAggregated>({
  tableName: "BarAggregated",
  materializedViewName: "BarAggregated_MV",
  orderByFields: ["dayOfMonth"],
  selectStatement: sql`SELECT
    toDayOfMonth(${barColumns.utcTimestamp}) as dayOfMonth,
    count(${barColumns.primaryKey}) as totalRows,
    countIf(${barColumns.hasText}) as rowsWithText,
    sum(${barColumns.textLength}) as totalTextLength,
    max(${barColumns.textLength}) as maxTextLength
  FROM ${BarTable}
  GROUP BY toDayOfMonth(utcTimestamp)
  `,
  selectTables: [BarTable],
});
