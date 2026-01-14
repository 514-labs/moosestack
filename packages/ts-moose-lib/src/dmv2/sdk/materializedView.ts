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

/**
 * Configuration options for creating a Materialized View.
 * @template T The data type of the records stored in the target table of the materialized view.
 */
export interface MaterializedViewConfig<T> {
  /** The SQL SELECT statement or `Sql` object defining the data to be materialized. Dynamic SQL (with parameters) is not allowed here. */
  selectStatement: string | Sql;
  /** An array of OlapTable or View objects that the `selectStatement` reads from. */
  selectTables: (OlapTable<any> | View)[];

  /** @deprecated See {@link targetTable}
   *  The name for the underlying target OlapTable that stores the materialized data. */
  tableName?: string;

  /** The name for the ClickHouse MATERIALIZED VIEW object itself. */
  materializedViewName: string;

  /** @deprecated See {@link targetTable}
   *  Optional ClickHouse engine for the target table (e.g., ReplacingMergeTree). Defaults to MergeTree. */
  engine?: ClickHouseEngines;

  targetTable?:
    | OlapTable<T> /**  Target table if the OlapTable object is already constructed. */
    | {
        /** The name for the underlying target OlapTable that stores the materialized data. */
        name: string;
        /** Optional ClickHouse engine for the target table (e.g., ReplacingMergeTree). Defaults to MergeTree. */
        engine?: ClickHouseEngines;
        /** Optional ordering fields for the target table. Crucial if using ReplacingMergeTree. */
        orderByFields?: (keyof T & string)[];
      };

  /** @deprecated See {@link targetTable}
   *  Optional ordering fields for the target table. Crucial if using ReplacingMergeTree. */
  orderByFields?: (keyof T & string)[];

  /** Optional metadata for the materialized view (e.g., description, source file). */
  metadata?: { [key: string]: any };
}

const requireTargetTableName = (tableName: string | undefined): string => {
  if (typeof tableName === "string") {
    return tableName;
  } else {
    throw new Error("Name of targetTable is not specified.");
  }
};

/**
 * Represents a Materialized View in ClickHouse.
 * This encapsulates both the target OlapTable that stores the data and the MATERIALIZED VIEW definition
 * that populates the table based on inserts into the source tables.
 *
 * @template TargetTable The data type of the records stored in the underlying target OlapTable. The structure of T defines the target table schema.
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
   * Creates a new MaterializedView instance.
   * Requires the `TargetTable` type parameter to be explicitly provided or inferred,
   * as it's needed to define the schema of the underlying target table.
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
    let selectStatement = options.selectStatement;
    if (typeof selectStatement !== "string") {
      selectStatement = toStaticQuery(selectStatement);
    }

    if (targetSchema === undefined || targetColumns === undefined) {
      throw new Error(
        "Supply the type param T so that the schema is inserted by the compiler plugin.",
      );
    }

    const targetTable =
      options.targetTable instanceof OlapTable ?
        options.targetTable
      : new OlapTable(
          requireTargetTableName(
            options.targetTable?.name ?? options.tableName,
          ),
          {
            orderByFields:
              options.targetTable?.orderByFields ?? options.orderByFields,
            engine:
              options.targetTable?.engine ??
              options.engine ??
              ClickHouseEngines.MergeTree,
          } as OlapConfig<TargetTable>,
          targetSchema,
          targetColumns,
        );

    if (targetTable.name === options.materializedViewName) {
      throw new Error(
        "Materialized view name cannot be the same as the target table name.",
      );
    }

    this.name = options.materializedViewName;
    this.targetTable = targetTable;
    this.selectSql = selectStatement;
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
}
