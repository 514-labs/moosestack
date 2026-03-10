import { Sql, toStaticQuery } from "../../sqlHelpers";
import { OlapTable } from "./olapTable";
import { getMooseInternal, isClientOnlyMode } from "../internal";
import { getSourceFileFromStack } from "../utils/stackTrace";
import { formatTableReference } from "./tableReferenceUtils";

/**
 * Configuration options for creating a View.
 */
export interface ViewConfig {
  /** The SQL SELECT statement or Sql object defining the view's logic. */
  selectStatement: string | Sql;
  /** Source tables/views the SELECT reads from. Used for dependency tracking during migrations. */
  baseTables: (OlapTable<any> | View)[];
  /** Optional database where the view is created. When set, the view is created as `database`.`name` in ClickHouse. */
  database?: string;
  /** Optional metadata for the view (e.g., description, source file). */
  metadata?: { [key: string]: any };
}

/**
 * Represents a database View, defined by a SQL SELECT statement based on one or more base tables or other views.
 * Emits structured data for the Moose infrastructure system.
 */
export class View {
  /** @internal */
  public readonly kind = "View";

  /** The name of the view */
  name: string;

  /** Optional database where the view is created. When set, the view is created as `database`.`name` in ClickHouse. */
  database?: string;

  /** The SELECT SQL statement that defines the view */
  selectSql: string;

  /** Names of source tables/views that the SELECT reads from */
  sourceTables: string[];

  /** Optional metadata for the view */
  metadata: { [key: string]: any };

  /**
   * Creates a new View instance.
   * @param name The name of the view to be created.
   * @param config Configuration for the view: select statement, base tables, optional database, and optional metadata.
   */
  constructor(name: string, config: ViewConfig) {
    let selectStatement = config.selectStatement;
    if (typeof selectStatement !== "string") {
      selectStatement = toStaticQuery(selectStatement);
    }

    this.name = name;
    this.database = config.database;
    this.selectSql = selectStatement;
    this.sourceTables = config.baseTables.map((t) => formatTableReference(t));

    // Initialize metadata, preserving user-provided metadata if any
    this.metadata = config.metadata ? { ...config.metadata } : {};

    // Capture source file from stack trace if not already provided
    if (!this.metadata.source) {
      const stack = new Error().stack;
      const sourceInfo = getSourceFileFromStack(stack);
      if (sourceInfo) {
        this.metadata.source = { file: sourceInfo };
      }
    }

    // Register in the views registry
    const views = getMooseInternal().views;
    if (!isClientOnlyMode() && views.has(this.name)) {
      throw new Error(`View with name ${this.name} already exists`);
    }
    views.set(this.name, this);
  }
}
