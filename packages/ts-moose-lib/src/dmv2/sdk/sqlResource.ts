import { getMooseInternal } from "../internal";
import { OlapTable } from "./olapTable";
import { Sql, toStaticQuery } from "../../sqlHelpers";

type SqlObject = OlapTable<any> | SqlResource;

/**
 * Utility to extract the first file path outside node_modules from a stack trace.
 */
function getSourceFileFromStack(stack?: string): string | undefined {
  if (!stack) return undefined;
  const lines = stack.split("\n");
  for (const line of lines) {
    // Skip lines from node_modules, internal loaders, and moose-lib internals
    if (
      line.includes("node_modules") || // Skip npm installed packages (prod)
      line.includes("internal/modules") || // Skip Node.js internals
      line.includes("ts-node") || // Skip TypeScript execution
      line.includes("/ts-moose-lib/") || // Skip dev/linked moose-lib (Unix)
      line.includes("\\ts-moose-lib\\") // Skip dev/linked moose-lib (Windows)
    )
      continue;
    // Extract file path from the line
    const match =
      line.match(/\((.*):(\d+):(\d+)\)/) || line.match(/at (.*):(\d+):(\d+)/);
    if (match && match[1]) {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Represents a generic SQL resource that requires setup and teardown commands.
 * Base class for constructs like Views and Materialized Views. Tracks dependencies.
 */
export class SqlResource {
  /** @internal */
  public readonly kind = "SqlResource";

  /** Array of SQL statements to execute for setting up the resource. */
  setup: readonly string[];
  /** Array of SQL statements to execute for tearing down the resource. */
  teardown: readonly string[];
  /** The name of the SQL resource (e.g., view name, materialized view name). */
  name: string;

  /** List of OlapTables or Views that this resource reads data from. */
  pullsDataFrom: SqlObject[];
  /** List of OlapTables or Views that this resource writes data to. */
  pushesDataTo: SqlObject[];

  /** @internal Source file path where this resource was defined */
  sourceFile?: string;

  /**
   * Creates a new SqlResource instance.
   * @param name The name of the resource.
   * @param setup An array of SQL DDL statements to create the resource.
   * @param teardown An array of SQL DDL statements to drop the resource.
   * @param options Optional configuration for specifying data dependencies.
   * @param options.pullsDataFrom Tables/Views this resource reads from.
   * @param options.pushesDataTo Tables/Views this resource writes to.
   */
  constructor(
    name: string,
    setup: readonly (string | Sql)[],
    teardown: readonly (string | Sql)[],
    options?: {
      pullsDataFrom?: SqlObject[];
      pushesDataTo?: SqlObject[];
    },
  ) {
    const sqlResources = getMooseInternal().sqlResources;
    if (sqlResources.has(name)) {
      throw new Error(`SqlResource with name ${name} already exists`);
    }
    sqlResources.set(name, this);

    this.name = name;
    this.setup = setup.map((sql) =>
      typeof sql === "string" ? sql : toStaticQuery(sql),
    );
    this.teardown = teardown.map((sql) =>
      typeof sql === "string" ? sql : toStaticQuery(sql),
    );
    this.pullsDataFrom = options?.pullsDataFrom ?? [];
    this.pushesDataTo = options?.pushesDataTo ?? [];

    // Capture source file from stack trace
    const stack = new Error().stack;
    this.sourceFile = getSourceFileFromStack(stack);
  }
}
