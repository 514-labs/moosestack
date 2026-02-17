import { Sql, toStaticQuery } from "../../sqlHelpers";
import { TableReference, formatTableReference } from "./olapTable";
import { getMooseInternal, isClientOnlyMode } from "../internal";
import { getSourceFileFromStack } from "../utils/stackTrace";

/**
 * Represents a database View, defined by a SQL SELECT statement based on one or more base tables or other views.
 * Emits structured data for the Moose infrastructure system.
 */
export class View {
  /** @internal */
  public readonly kind = "View";

  /** The name of the view */
  name: string;

  /** The SELECT SQL statement that defines the view */
  selectSql: string;

  /** Names of source tables/views that the SELECT reads from */
  sourceTables: string[];

  /** Optional metadata for the view */
  metadata: { [key: string]: unknown };

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
    baseTables: (TableReference | View)[],
    metadata?: { [key: string]: unknown },
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

    // Register in the views registry
    const views = getMooseInternal().views;
    if (!isClientOnlyMode() && views.has(this.name)) {
      throw new Error(`View with name ${this.name} already exists`);
    }
    views.set(this.name, this);
  }
}
