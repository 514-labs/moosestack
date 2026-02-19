import { MaterializedView, LifeCycle, Key, DateTime } from "@514labs/moose-lib";
import { BasicTypesPipeline } from "../ingest/models";

/**
 * Lifecycle MV Test Resources
 *
 * These materialized views test LifeCycle behavior on MVs:
 * - DELETION_PROTECTED MV: create OK, but DROP and UPDATE (SELECT change) blocked
 * - FULLY_MANAGED MV: all operations (create, update, delete) allowed
 *
 * Note: EXTERNALLY_MANAGED MVs are not defined here because they should never
 * be created - tests add them dynamically after server start.
 */

const basicTypesTable = BasicTypesPipeline.table!;

/** Target schema for lifecycle MV tests */
interface LifecycleMVTarget {
  id: Key<string>;
  timestamp: DateTime;
}

/**
 * DELETION_PROTECTED materialized view
 * Tests: Create OK, DROP blocked, UPDATE (SELECT change) blocked
 */
export const deletionProtectedMV = new MaterializedView<LifecycleMVTarget>({
  materializedViewName: "DeletionProtectedMV",
  targetTable: {
    name: "DeletionProtectedMVTarget",
    orderByFields: ["id", "timestamp"],
  },
  selectStatement: `SELECT id, timestamp FROM \`${basicTypesTable.name}\``,
  selectTables: [basicTypesTable],
  lifeCycle: LifeCycle.DELETION_PROTECTED,
});

/**
 * FULLY_MANAGED materialized view (default)
 * Tests: All operations (create, update, delete) allowed
 */
export const fullyManagedMV = new MaterializedView<LifecycleMVTarget>({
  materializedViewName: "FullyManagedMV",
  targetTable: {
    name: "FullyManagedMVTarget",
    orderByFields: ["id", "timestamp"],
  },
  selectStatement: `SELECT id, timestamp FROM \`${basicTypesTable.name}\``,
  selectTables: [basicTypesTable],
  // lifeCycle defaults to FULLY_MANAGED
});
