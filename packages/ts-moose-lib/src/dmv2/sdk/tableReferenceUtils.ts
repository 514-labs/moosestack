import { OlapTable } from "./olapTable";

/** Minimal interface for any table/view that may have a database qualifier */
interface TableLike {
  name: string;
  database?: string;
}

/**
 * Formats a table/view reference as `database`.`table` or just `table`.
 * Shared by View and MaterializedView to avoid duplication.
 */
export function formatTableReference(
  table: OlapTable<any> | TableLike,
): string {
  const database =
    table instanceof OlapTable ? table.config.database : table.database;
  if (database) {
    return `\`${database}\`.\`${table.name}\``;
  }
  return `\`${table.name}\``;
}
