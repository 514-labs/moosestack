import { OlapTable } from "./olapTable";

/**
 * Formats a table/view reference as `database`.`table` or just `table`.
 * Shared by View and MaterializedView to avoid duplication.
 */
export function formatTableReference(
  table: OlapTable<any> | { name: string; database?: string },
): string {
  const database =
    table instanceof OlapTable ? table.config.database : table.database;
  const deployedName =
    table instanceof OlapTable ? table.generateTableName() : table.name;
  if (database) {
    return `\`${database}\`.\`${deployedName}\``;
  }
  return `\`${deployedName}\``;
}
