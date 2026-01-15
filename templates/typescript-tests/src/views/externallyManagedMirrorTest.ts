import typia from "typia";
import { MaterializedView, sql } from "@514labs/moose-lib";
import { externallyManagedTable } from "../ingest/models";

/**
 * Test for ENG-1737: MaterializedViews that reference EXTERNALLY_MANAGED tables
 *
 * This test verifies that when dev.externally_managed.tables.create_local_mirrors
 * is enabled in moose.config.toml, materialized views can successfully reference
 * EXTERNALLY_MANAGED tables by creating local mirror tables automatically.
 */

/** Aggregated data from externally managed table */
interface ExternallyManagedAggregated {
  category: string;
  totalRecords: number & typia.tags.Type<"int64">;
  uniqueIds: number & typia.tags.Type<"int64">;
}

const externalColumns = externallyManagedTable.columns;

export const ExternallyManagedAggregatedMV =
  new MaterializedView<ExternallyManagedAggregated>({
    tableName: "ExternallyManagedAggregated",
    materializedViewName: "ExternallyManagedAggregated_MV",
    orderByFields: ["category"],
    selectStatement: sql`SELECT
    ${externalColumns.category} as category,
    count(${externalColumns.id}) as totalRecords,
    uniq(${externalColumns.id}) as uniqueIds
  FROM ${externallyManagedTable}
  GROUP BY category
  `,
    selectTables: [externallyManagedTable],
  });
