import { ClickHouseEngines } from "../../dataModels/types";
import { Sql, toStaticQuery } from "../../sqlHelpers";
import { OlapConfig, OlapTable } from "./olapTable";
import { View } from "./view";
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
 * Refresh interval using EVERY mode - periodic refresh at fixed times.
 * Example: { type: "every", interval: "1 hour" } => REFRESH EVERY 1 HOUR
 */
export interface RefreshIntervalEvery {
  type: "every";
  /** Interval string like "1 hour", "30 minutes", "1 day" */
  interval: string;
}

/**
 * Refresh interval using AFTER mode - refresh after interval since last refresh.
 * Example: { type: "after", interval: "30 minutes" } => REFRESH AFTER 30 MINUTES
 */
export interface RefreshIntervalAfter {
  type: "after";
  /** Interval string like "1 hour", "30 minutes", "1 day" */
  interval: string;
}

/**
 * Refresh interval specification - either EVERY or AFTER mode.
 */
export type RefreshInterval = RefreshIntervalEvery | RefreshIntervalAfter;

/**
 * Configuration for refreshable (scheduled) materialized views.
 *
 * Refreshable MVs run on a schedule (REFRESH EVERY/AFTER) rather than
 * being triggered by inserts to source tables.
 */
export interface RefreshConfig {
  /** The refresh interval (EVERY or AFTER) */
  interval: RefreshInterval;
  /** Optional offset from interval start, e.g., "5 minutes" */
  offset?: string;
  /** Optional randomization window, e.g., "10 seconds" */
  randomize?: string;
  /** Names of other MVs this one depends on */
  dependsOn?: string[];
  /** Use APPEND mode instead of full refresh */
  append?: boolean;
}

// ============================================================================
// MaterializedView Configuration
// ============================================================================

/**
 * Configuration options for creating a Materialized View.
 *
 * Two types of materialized views are supported:
 * - **Incremental**: Triggered on every insert to source tables (when refreshConfig is NOT set)
 * - **Refreshable**: Runs on a schedule (when refreshConfig IS set)
 *
 * @template T The data type of the records stored in the target table of the materialized view.
 */
export interface MaterializedViewConfig<T> {
  /** The SQL SELECT statement or `Sql` object defining the data to be materialized. Dynamic SQL (with parameters) is not allowed here. */
  selectStatement: string | Sql;

  /**
   * The source tables/views that the SELECT statement reads from.
   * Required for ALL materialized views.
   *
   * - For incremental MVs: these tables trigger the MV on insert
   * - For refreshable MVs: these tables are read during scheduled refresh (data lineage)
   */
  selectTables: (OlapTable<any> | View)[];

  /** The name for the ClickHouse MATERIALIZED VIEW object itself. */
  materializedViewName: string;

  /**
   * The target table where transformed data is written.
   * Can be an existing OlapTable or inline configuration to create one.
   *
   * Preferred over the deprecated tableName/engine/orderByFields fields.
   */
  targetTable?:
    | OlapTable<T>
    | {
        /** The name for the underlying target OlapTable that stores the materialized data. */
        name: string;
        /**
         * ClickHouse engine for the target table (e.g., ReplacingMergeTree).
         * Defaults to MergeTree.
         *
         * Note: Custom engines are only supported for incremental MVs.
         * Refreshable MVs must use the default MergeTree engine.
         */
        engine?: ClickHouseEngines;
        /** Optional ordering fields for the target table. Crucial if using ReplacingMergeTree. */
        orderByFields?: (keyof T & string)[];
      };

  /**
   * @deprecated Use targetTable instead.
   * The name for the underlying target OlapTable that stores the materialized data.
   */
  tableName?: string;

  /**
   * @deprecated Use targetTable instead.
   * Optional ClickHouse engine for the target table (e.g., ReplacingMergeTree). Defaults to MergeTree.
   */
  engine?: ClickHouseEngines;

  /**
   * @deprecated Use targetTable instead.
   * Optional ordering fields for the target table. Crucial if using ReplacingMergeTree.
   */
  orderByFields?: (keyof T & string)[];

  /**
   * Configuration for refreshable (scheduled) materialized views.
   *
   * - If set: The MV runs on a schedule (REFRESH EVERY/AFTER)
   * - If not set: The MV is incremental (triggered by inserts to selectTables)
   *
   * Note: Refreshable MVs cannot use custom engines on the target table.
   */
  refreshConfig?: RefreshConfig;

  /** Optional metadata for the materialized view (e.g., description, source file). */
  metadata?: { [key: string]: any };
}

/**
 * Represents a Materialized View in ClickHouse.
 *
 * Two types are supported:
 * - **Incremental**: Triggered on inserts to source tables (refreshConfig not set)
 * - **Refreshable**: Runs on a schedule (refreshConfig is set)
 *
 * @template TargetTable The data type of the records stored in the underlying target OlapTable.
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

  /**
   * The refresh configuration if this is a refreshable MV.
   * If undefined, this is an incremental MV.
   * @internal
   */
  refreshConfig?: RefreshConfig;

  /**
   * Creates a new MaterializedView instance.
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
    // Support both new (targetTable) and deprecated (tableName/engine/orderByFields) approaches
    const isRefreshable = options.refreshConfig !== undefined;
    let targetTableEngine: ClickHouseEngines | undefined;
    let targetTable: OlapTable<TargetTable>;

    if (options.targetTable !== undefined && options.tableName !== undefined) {
      throw new Error(
        "Cannot specify both 'targetTable' and 'tableName'. " +
          "Use 'targetTable' (preferred) or 'tableName' (deprecated).",
      );
    }

    if (options.targetTable instanceof OlapTable) {
      // Using existing OlapTable directly
      targetTable = options.targetTable;
      const config = targetTable.config as { engine?: ClickHouseEngines };
      targetTableEngine = config.engine;
    } else if (options.targetTable) {
      // Using inline targetTable config (preferred)
      targetTableEngine = options.targetTable.engine;
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
      // Using deprecated tableName/engine/orderByFields
      targetTableEngine = options.engine;
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

    // Validate: refreshable MVs cannot use custom engines
    if (
      isRefreshable &&
      targetTableEngine !== undefined &&
      targetTableEngine !== ClickHouseEngines.MergeTree
    ) {
      throw new Error(
        "Refreshable materialized views cannot use custom engines. " +
          `Found engine '${targetTableEngine}' but refreshable MVs only support MergeTree. ` +
          "Remove the 'engine' option or remove 'refreshConfig' to create an incremental MV.",
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
    this.refreshConfig = options.refreshConfig;

    // Set sourceTables from the selectTables configuration
    this.sourceTables = options.selectTables.map((t) =>
      formatTableReference(t),
    );

    // Initialize metadata, preserving user-provided metadata if any
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
   * Returns true if this is an incremental (trigger-based) materialized view.
   */
  isIncremental(): boolean {
    return this.refreshConfig === undefined;
  }

  /**
   * Returns true if this is a refreshable (scheduled) materialized view.
   */
  isRefreshable(): boolean {
    return this.refreshConfig !== undefined;
  }

  /**
   * Returns the refresh configuration if this is a refreshable MV.
   */
  getRefreshConfig(): RefreshConfig | undefined {
    return this.refreshConfig;
  }
}
