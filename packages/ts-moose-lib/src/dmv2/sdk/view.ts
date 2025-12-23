import { dropView } from "../../blocks/helpers";
import { Sql, toStaticQuery } from "../../sqlHelpers";
import { OlapTable } from "./olapTable";
import { SqlResource } from "./sqlResource";

/**
 * Represents a database View, defined by a SQL SELECT statement based on one or more base tables or other views.
 * Inherits from SqlResource, providing setup (CREATE VIEW) and teardown (DROP VIEW) commands.
 */
export class View extends SqlResource {
  /**
   * Creates a new View instance.
   * @param name The name of the view to be created.
   * @param selectStatement The SQL SELECT statement that defines the view's logic.
   * @param baseTables An array of OlapTable or View objects that the `selectStatement` reads from. Used for dependency tracking.
   */
  constructor(
    name: string,
    selectStatement: string | Sql,
    baseTables: (OlapTable<any> | View)[],
  ) {
    if (typeof selectStatement !== "string") {
      selectStatement = toStaticQuery(selectStatement);
    }

    super(
      name,
      [
        `CREATE VIEW IF NOT EXISTS ${name} 
          AS ${selectStatement}`.trim(),
      ],
      [dropView(name)],
      {
        pullsDataFrom: baseTables,
      },
    );
  }
}
