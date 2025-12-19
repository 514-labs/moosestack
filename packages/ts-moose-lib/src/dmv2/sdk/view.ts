import { Sql, toStaticQuery } from "../../sqlHelpers";
import { OlapTable } from "./olapTable";
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
 * Represents a database View, defined by a SQL SELECT statement based on one or more base tables or other views.
 * Emits structured data for the Moose infrastructure system.
 */
export class View {
  /** @internal */
  public readonly kind = "CustomView";

  /** The name of the view */
  name: string;

  /** The SELECT SQL statement that defines the view */
  selectSql: string;

  /** Names of source tables/views that the SELECT reads from */
  sourceTables: string[];

  /** Optional metadata for the view */
  metadata: { [key: string]: any };

  /**
   * Creates a new View instance.
   * @param name The name of the view to be created.
   * @param selectStatement The SQL SELECT statement that defines the view's logic.
   * @param baseTables An array of OlapTable or View objects that the `selectStatement` reads from. Used for dependency tracking.
   * @param metadata Optional metadata for the view (e.g., description, source file).
   */
  constructor(
    name: string,
    selectStatement: string | Sql,
    baseTables: (OlapTable<any> | View)[],
    metadata?: { [key: string]: any },
  ) {
    if (typeof selectStatement !== "string") {
      selectStatement = toStaticQuery(selectStatement);
    }

    this.name = name;
    this.selectSql = selectStatement;
    this.sourceTables = baseTables.map((t) => formatTableReference(t));

    // Initialize metadata, preserving user-provided metadata if any
    this.metadata = metadata ? { ...metadata } : {};

    // Capture source file from stack trace if not already provided
    if (!this.metadata.source) {
      const stack = new Error().stack;
      const sourceInfo = getSourceFileFromStack(stack);
      if (sourceInfo) {
        this.metadata.source = { file: sourceInfo };
      }
    }

    // Register in the customViews registry
    const customViews = getMooseInternal().customViews;
    if (!isClientOnlyMode() && customViews.has(this.name)) {
      throw new Error(`View with name ${this.name} already exists`);
    }
    customViews.set(this.name, this);
  }
}
