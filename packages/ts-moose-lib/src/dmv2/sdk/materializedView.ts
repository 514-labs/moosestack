import {
  ClickHouseEngines,
  createMaterializedView,
  dropView,
} from "../../blocks/helpers";
import { Sql, toStaticQuery } from "../../sqlHelpers";
import { OlapConfig, OlapTable } from "./olapTable";
import { SqlResource } from "./sqlResource";
import { View } from "./view";
import { IJsonSchemaCollection } from "typia";
import { Column } from "../../dataModels/dataModelTypes";

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
export class MaterializedView<TargetTable> extends SqlResource {
  /** The target OlapTable instance where the materialized data is stored. */
  targetTable: OlapTable<TargetTable>;

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
            engine: (options.targetTable?.engine ??
              options.engine ??
              ClickHouseEngines.MergeTree) as ClickHouseEngines.MergeTree,
          } as OlapConfig<TargetTable>,
          targetSchema,
          targetColumns,
        );

    if (targetTable.name === options.materializedViewName) {
      throw new Error(
        "Materialized view name cannot be the same as the target table name.",
      );
    }

    super(
      options.materializedViewName,
      [
        createMaterializedView({
          name: options.materializedViewName,
          destinationTable: targetTable.name,
          select: selectStatement,
        }),
        // Population is now handled automatically by Rust infrastructure
        // based on table engine type and whether this is a new or updated view
      ],
      [dropView(options.materializedViewName)],
      {
        pullsDataFrom: options.selectTables,
        pushesDataTo: [targetTable],
      },
    );

    this.targetTable = targetTable;
  }
}
