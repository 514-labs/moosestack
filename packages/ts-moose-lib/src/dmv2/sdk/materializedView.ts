import { ClickHouseEngines } from "../../dataModels/types";
import { Sql, toStaticQuery } from "../../sqlHelpers";
import { OlapConfig, OlapTable } from "./olapTable";
import { View } from "./view";
import { LifeCycle } from "./lifeCycle";
import { IJsonSchemaCollection } from "typia";
import { Column } from "../../dataModels/dataModelTypes";
import { getMooseInternal, isClientOnlyMode } from "../internal";
import { getSourceFileFromStack } from "../utils/stackTrace";

/**
 * Helper function to format a table reference as `database`.`table` or just `table`
 */
function formatTableReference(table: OlapTable<any> | View): string {
  const database =
    table instanceof OlapTable ? table.config.database : undefined;
  if (database) {
    return `\`${database}\`.\`${table.name}\``;
  }
  return `\`${table.name}\``;
}

// ============================================================================
// Refresh Configuration Types for Refreshable Materialized Views
// ============================================================================

/**
 * Supported time units for refresh intervals.
 * Maps directly to ClickHouse interval units.
 */
export type TimeUnit =
  | "second"
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "year";

/**
 * Refresh interval using EVERY mode - periodic refresh at fixed times.
 * Example: { type: "every", value: 1, unit: "hour" } => REFRESH EVERY 1 HOUR
 */
export interface RefreshIntervalEvery {
  type: "every";
  /** The numeric value of the interval */
  value: number;
  /** The time unit for the interval */
  unit: TimeUnit;
}

/**
 * Refresh interval using AFTER mode - refresh after interval since last refresh.
 * Example: { type: "after", value: 30, unit: "minute" } => REFRESH AFTER 30 MINUTE
 */
export interface RefreshIntervalAfter {
  type: "after";
  /** The numeric value of the interval */
  value: number;
  /** The time unit for the interval */
  unit: TimeUnit;
}

/**
 * Refresh interval specification - either EVERY or AFTER mode.
 */
export type RefreshInterval = RefreshIntervalEvery | RefreshIntervalAfter;

/**
 * A duration specified as value + unit.
 * Used for offset and randomize configurations.
 */
export interface Duration {
  /** The numeric value */
  value: number;
  /** The time unit */
  unit: TimeUnit;
}

/**
 * Configuration for refreshable (scheduled) materialized views.
 *
 * @example
 * ```typescript
 * const mv = new RefreshableMaterializedView<Stats>({
 *   materializedViewName: "hourly_stats_mv",
 *   selectStatement: "SELECT count(*) as cnt FROM events",
 *   selectTables: [eventsTable],
 *   targetTable: { name: "hourly_stats" },
 *   refreshConfig: {
 *     interval: { type: "every", value: 1, unit: "hour" },
 *     offset: { value: 5, unit: "minute" },
 *   },
 * });
 * ```
 */
export interface RefreshConfig {
  /** The refresh interval (EVERY or AFTER) */
  interval: RefreshInterval;
  /**
   * Optional offset from interval start.
   * NOTE: Only valid with REFRESH EVERY, not REFRESH AFTER.
   */
  offset?: Duration;
  /** Optional randomization window */
  randomize?: Duration;
  /**
   * Other refreshable MVs this one depends on (will wait for them to refresh first).
   * Only accepts RefreshableMaterializedView objects - ensures type safety.
   */
  dependsOn?: RefreshableMaterializedView<any>[];
  /** Use APPEND mode instead of full refresh */
  append?: boolean;
}

/**
 * Internal representation of RefreshConfig with dependsOn converted to string names.
 * @internal
 */
export interface ResolvedRefreshConfig {
  interval: RefreshInterval;
  offset?: Duration;
  randomize?: Duration;
  /** Names of other MVs this one depends on (already resolved to strings) */
  dependsOn?: string[];
  append?: boolean;
}

// ============================================================================
// Incremental MaterializedView Configuration and Class
// ============================================================================

/**
 * Configuration options for creating an incremental Materialized View.
 *
 * Incremental MVs are triggered on every insert to source tables.
 *
 * @template T The data type of the records stored in the target table.
 */
export interface MaterializedViewConfig<T> {
  /** The SQL SELECT statement or `Sql` object defining the data to be materialized. */
  selectStatement: string | Sql;

  /**
   * The source tables/views that the SELECT statement reads from.
   * These tables trigger the MV on insert.
   */
  selectTables: (OlapTable<any> | View)[];

  /** The name for the ClickHouse MATERIALIZED VIEW object itself. */
  materializedViewName: string;

  /**
   * The target table where transformed data is written.
   * Can be an existing OlapTable or inline configuration to create one.
   */
  targetTable?:
    | OlapTable<T>
    | {
        /** The name for the underlying target OlapTable. */
        name: string;
        /**
         * ClickHouse engine for the target table (e.g., ReplacingMergeTree).
         * Defaults to MergeTree.
         */
        engine?: ClickHouseEngines;
        /** Optional ordering fields for the target table. */
        orderByFields?: (keyof T & string)[];
      };

  /**
   * @deprecated Use targetTable instead.
   */
  tableName?: string;

  /**
   * @deprecated Use targetTable instead.
   */
  engine?: ClickHouseEngines;

  /**
   * @deprecated Use targetTable instead.
   */
  orderByFields?: (keyof T & string)[];

  /** Optional metadata for the materialized view. */
  metadata?: { [key: string]: any };

  /** Optional lifecycle management policy for the materialized view.
   * Controls whether Moose can drop or modify the MV automatically.
   * Defaults to FULLY_MANAGED if not specified. */
  lifeCycle?: LifeCycle;
}

/**
 * Represents an incremental Materialized View in ClickHouse.
 *
 * Incremental MVs are triggered on every insert to source tables.
 * For scheduled/refreshable MVs, use `RefreshableMaterializedView` instead.
 *
 * @template TargetTable The data type of the records stored in the target table.
 */
export class MaterializedView<TargetTable> {
  /** @internal */
  public readonly kind = "MaterializedView";

  /** The name of the materialized view */
  name: string;

  /** The target OlapTable instance where the materialized data is stored. */
  targetTable: OlapTable<TargetTable>;

  /** The SELECT SQL statement */
  selectSql: string;

  /** Names of source tables that the SELECT reads from */
  sourceTables: string[];

  /** Optional metadata for the materialized view */
  metadata: { [key: string]: any };

  /** Optional lifecycle management policy for the materialized view */
  lifeCycle?: LifeCycle;

  /**
   * Always undefined for incremental MVs.
   * @internal
   */
  refreshConfig?: undefined;

  /**
   * Creates a new incremental MaterializedView instance.
   *
   * @param options Configuration options for the materialized view.
   */
  constructor(options: MaterializedViewConfig<TargetTable>);

  /** @internal **/
  constructor(
    options: MaterializedViewConfig<TargetTable>,
    targetSchema: IJsonSchemaCollection.IV3_1,
    targetColumns: Column[],
  );
  constructor(
    options: MaterializedViewConfig<TargetTable>,
    targetSchema?: IJsonSchemaCollection.IV3_1,
    targetColumns?: Column[],
  ) {
    // Validate selectStatement
    let selectStatement = options.selectStatement;
    if (typeof selectStatement !== "string") {
      selectStatement = toStaticQuery(selectStatement);
    }

    if (targetSchema === undefined || targetColumns === undefined) {
      throw new Error(
        "Supply the type param T so that the schema is inserted by the compiler plugin.",
      );
    }

    // Validate selectTables is provided and not empty
    if (!options.selectTables || options.selectTables.length === 0) {
      throw new Error(
        "MaterializedView requires 'selectTables' to be specified with at least one table. " +
          "These are the tables that your SELECT statement reads from.",
      );
    }

    // Resolve target table configuration
    let targetTable: OlapTable<TargetTable>;

    if (options.targetTable !== undefined && options.tableName !== undefined) {
      throw new Error(
        "Cannot specify both 'targetTable' and 'tableName'. " +
          "Use 'targetTable' (preferred) or 'tableName' (deprecated).",
      );
    }

    if (options.targetTable instanceof OlapTable) {
      targetTable = options.targetTable;
    } else if (options.targetTable) {
      targetTable = new OlapTable(
        options.targetTable.name,
        {
          orderByFields: options.targetTable.orderByFields,
          engine: options.targetTable.engine ?? ClickHouseEngines.MergeTree,
        } as OlapConfig<TargetTable>,
        targetSchema,
        targetColumns,
      );
    } else if (options.tableName) {
      targetTable = new OlapTable(
        options.tableName,
        {
          orderByFields: options.orderByFields,
          engine: options.engine ?? ClickHouseEngines.MergeTree,
        } as OlapConfig<TargetTable>,
        targetSchema,
        targetColumns,
      );
    } else {
      throw new Error(
        "Target table must be specified. Use one of:\n" +
          "  targetTable: myOlapTable              // existing OlapTable\n" +
          "  targetTable: { name: 'my_table' }     // inline config\n" +
          "  tableName: 'my_table'                 // deprecated",
      );
    }

    if (targetTable.name === options.materializedViewName) {
      throw new Error(
        "Materialized view name cannot be the same as the target table name.",
      );
    }

    this.name = options.materializedViewName;
    this.targetTable = targetTable;
    this.selectSql = selectStatement;
    this.refreshConfig = undefined;

    // Set sourceTables from the selectTables configuration
    this.sourceTables = options.selectTables.map((t) =>
      formatTableReference(t),
    );
    this.lifeCycle = options.lifeCycle;

    // Initialize metadata
    this.metadata = options.metadata ? { ...options.metadata } : {};

    // Capture source file from stack trace if not already provided
    if (!this.metadata.source) {
      const stack = new Error().stack;
      const sourceInfo = getSourceFileFromStack(stack);
      if (sourceInfo) {
        this.metadata.source = { file: sourceInfo };
      }
    }

    // Register in the materializedViews registry
    const materializedViews = getMooseInternal().materializedViews;
    if (!isClientOnlyMode() && materializedViews.has(this.name)) {
      throw new Error(`MaterializedView with name ${this.name} already exists`);
    }
    materializedViews.set(this.name, this);
  }

  /**
   * Returns true - incremental MVs are always incremental.
   */
  isIncremental(): boolean {
    return true;
  }

  /**
   * Returns false - incremental MVs are never refreshable.
   */
  isRefreshable(): boolean {
    return false;
  }
}

// ============================================================================
// Refreshable MaterializedView Configuration and Class
// ============================================================================

/**
 * Configuration options for creating a Refreshable Materialized View.
 *
 * Refreshable MVs run on a schedule (REFRESH EVERY/AFTER) rather than
 * being triggered by inserts to source tables.
 *
 * Note: Refreshable MVs always use MergeTree engine (no custom engine option).
 *
 * @template T The data type of the records stored in the target table.
 */
export interface RefreshableMaterializedViewConfig<T> {
  /** The SQL SELECT statement or `Sql` object defining the data to be materialized. */
  selectStatement: string | Sql;

  /**
   * The source tables/views that the SELECT statement reads from.
   * These define the data lineage for the refresh operation.
   */
  selectTables: (OlapTable<any> | View)[];

  /** The name for the ClickHouse MATERIALIZED VIEW object itself. */
  materializedViewName: string;

  /**
   * The target table where transformed data is written.
   * Can be an existing OlapTable or inline configuration to create one.
   *
   * Note: Custom engines are not supported for refreshable MVs (MergeTree only).
   */
  targetTable:
    | OlapTable<T>
    | {
        /** The name for the underlying target OlapTable. */
        name: string;
        /** Optional ordering fields for the target table. */
        orderByFields?: (keyof T & string)[];
      };

  /**
   * Configuration for the refresh schedule.
   * Required for refreshable MVs.
   */
  refreshConfig: RefreshConfig;

  /** Optional metadata for the materialized view. */
  metadata?: { [key: string]: any };
}

/**
 * Represents a Refreshable Materialized View in ClickHouse.
 *
 * Refreshable MVs run on a schedule (REFRESH EVERY/AFTER) rather than
 * being triggered by inserts to source tables.
 *
 * For incremental/trigger-based MVs, use `MaterializedView` instead.
 *
 * @template TargetTable The data type of the records stored in the target table.
 */
export class RefreshableMaterializedView<TargetTable> {
  /** @internal */
  public readonly kind = "MaterializedView";

  /** The name of the materialized view */
  name: string;

  /** The target OlapTable instance where the materialized data is stored. */
  targetTable: OlapTable<TargetTable>;

  /** The SELECT SQL statement */
  selectSql: string;

  /** Names of source tables that the SELECT reads from */
  sourceTables: string[];

  /** Optional metadata for the materialized view */
  metadata: { [key: string]: any };

  /**
   * The refresh configuration for this refreshable MV.
   * dependsOn is resolved to string names.
   * @internal
   */
  refreshConfig: ResolvedRefreshConfig;

  /**
   * Creates a new RefreshableMaterializedView instance.
   *
   * @param options Configuration options for the materialized view.
   */
  constructor(options: RefreshableMaterializedViewConfig<TargetTable>);

  /** @internal **/
  constructor(
    options: RefreshableMaterializedViewConfig<TargetTable>,
    targetSchema: IJsonSchemaCollection.IV3_1,
    targetColumns: Column[],
  );
  constructor(
    options: RefreshableMaterializedViewConfig<TargetTable>,
    targetSchema?: IJsonSchemaCollection.IV3_1,
    targetColumns?: Column[],
  ) {
    // Validate selectStatement
    let selectStatement = options.selectStatement;
    if (typeof selectStatement !== "string") {
      selectStatement = toStaticQuery(selectStatement);
    }

    if (targetSchema === undefined || targetColumns === undefined) {
      throw new Error(
        "Supply the type param T so that the schema is inserted by the compiler plugin.",
      );
    }

    // Validate selectTables is provided and not empty
    if (!options.selectTables || options.selectTables.length === 0) {
      throw new Error(
        "RefreshableMaterializedView requires 'selectTables' to be specified with at least one table. " +
          "These are the tables that your SELECT statement reads from.",
      );
    }

    // Resolve target table configuration
    let targetTable: OlapTable<TargetTable>;

    if (options.targetTable instanceof OlapTable) {
      targetTable = options.targetTable;
      // Validate no custom engine on existing OlapTable
      const config = targetTable.config as { engine?: ClickHouseEngines };
      if (
        config.engine !== undefined &&
        config.engine !== ClickHouseEngines.MergeTree
      ) {
        throw new Error(
          "RefreshableMaterializedView cannot use custom engines. " +
            `Found engine '${config.engine}' but refreshable MVs only support MergeTree.`,
        );
      }
    } else {
      targetTable = new OlapTable(
        options.targetTable.name,
        {
          orderByFields: options.targetTable.orderByFields,
          engine: ClickHouseEngines.MergeTree, // Always MergeTree
        } as OlapConfig<TargetTable>,
        targetSchema,
        targetColumns,
      );
    }

    if (targetTable.name === options.materializedViewName) {
      throw new Error(
        "Materialized view name cannot be the same as the target table name.",
      );
    }

    // Validate interval value is a positive integer
    const intervalVal = options.refreshConfig.interval.value;
    if (!Number.isInteger(intervalVal) || intervalVal <= 0) {
      throw new Error(
        `Refresh interval value must be a positive integer, got: ${intervalVal}`,
      );
    }

    // Validate offset/randomize values if present
    for (const key of ["offset", "randomize"] as const) {
      const dur = options.refreshConfig[key];
      if (dur && (!Number.isInteger(dur.value) || dur.value <= 0)) {
        throw new Error(
          `Refresh ${key} value must be a positive integer, got: ${dur.value}`,
        );
      }
    }

    // Validate OFFSET is not used with REFRESH AFTER (only valid with REFRESH EVERY)
    if (
      options.refreshConfig.interval.type === "after" &&
      options.refreshConfig.offset
    ) {
      throw new Error(
        "OFFSET is only valid with REFRESH EVERY, not REFRESH AFTER. " +
          "Remove the 'offset' option or change the interval type to 'every'.",
      );
    }

    this.name = options.materializedViewName;
    this.targetTable = targetTable;
    this.selectSql = selectStatement;

    // Convert refreshConfig.dependsOn from RefreshableMaterializedView objects to string names
    this.refreshConfig = {
      ...options.refreshConfig,
      dependsOn: options.refreshConfig.dependsOn?.map((dep) => dep.name),
    };

    // Set sourceTables from the selectTables configuration
    this.sourceTables = options.selectTables.map((t) =>
      formatTableReference(t),
    );

    // Initialize metadata
    this.metadata = options.metadata ? { ...options.metadata } : {};

    // Capture source file from stack trace if not already provided
    if (!this.metadata.source) {
      const stack = new Error().stack;
      const sourceInfo = getSourceFileFromStack(stack);
      if (sourceInfo) {
        this.metadata.source = { file: sourceInfo };
      }
    }

    // Register in the materializedViews registry
    const materializedViews = getMooseInternal().materializedViews;
    if (!isClientOnlyMode() && materializedViews.has(this.name)) {
      throw new Error(
        `A MaterializedView with name '${this.name}' is already registered.`,
      );
    }
    materializedViews.set(this.name, this);
  }

  /**
   * Returns false - refreshable MVs are never incremental.
   */
  isIncremental(): boolean {
    return false;
  }

  /**
   * Returns true - refreshable MVs are always refreshable.
   */
  isRefreshable(): boolean {
    return true;
  }

  /**
   * Returns the refresh configuration.
   */
  getRefreshConfig(): ResolvedRefreshConfig {
    return this.refreshConfig;
  }
}
