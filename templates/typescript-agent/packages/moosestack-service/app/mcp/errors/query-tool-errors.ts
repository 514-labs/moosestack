function extractTableName(message: string): string | null {
  const patterns = [
    /Table ['`]([^'"`]+)['`]/i,
    /Unknown table(?: expression identifier)? ['`]([^'"`]+)['`]/i,
    /([A-Za-z0-9_.]+) doesn't exist/i,
  ] as const;

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match?.[1]) {
      return match[1].split(".").pop() ?? match[1];
    }
  }

  return null;
}

function formatAvailableTableList(availableTables: string[]): string {
  return availableTables.length > 0 ? availableTables.join(", ") : "(none)";
}

export function formatQueryToolError(
  error: unknown,
  availableTables: string[],
): string {
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (/System metadata is not exposed by default/i.test(errorMessage)) {
    return "System metadata is not available to this tool. Use get_data_catalog to discover the exposed tables and columns.";
  }

  if (/not exposed by default/i.test(errorMessage)) {
    const tableName = extractTableName(errorMessage) ?? "requested table";
    return `Table '${tableName}' is not exposed to this tool. Available tables: ${formatAvailableTableList(availableTables)}. Use get_data_catalog before writing queries.`;
  }

  if (/Unknown table|doesn't exist/i.test(errorMessage)) {
    const tableName = extractTableName(errorMessage) ?? "requested table";
    return `Table '${tableName}' not found. Available tables: ${formatAvailableTableList(availableTables)}. Use get_data_catalog before writing queries.`;
  }

  if (
    /Only SELECT, DESCRIBE, and EXPLAIN SELECT queries against exposed data components are allowed by default/i.test(
      errorMessage,
    )
  ) {
    return "Only SELECT, DESCRIBE, and EXPLAIN SELECT queries against exposed data components are allowed.";
  }

  if (/Qualified table names are not allowed/i.test(errorMessage)) {
    return "Qualified table names are not allowed. Query exposed tables without a database prefix.";
  }

  if (
    /Comma-separated FROM and JOIN target lists are not allowed/i.test(
      errorMessage,
    )
  ) {
    return "Comma-separated FROM and JOIN target lists are not allowed. Use explicit JOIN syntax against exposed tables.";
  }

  return "Unable to execute the query. Verify that it is a read-only statement against exposed tables and try again.";
}
