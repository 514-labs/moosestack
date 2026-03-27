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

  if (/not exposed by default/i.test(errorMessage)) {
    return `${errorMessage} Use get_data_catalog before writing queries.`;
  }

  if (/Unknown table|doesn't exist/i.test(errorMessage)) {
    const tableName = extractTableName(errorMessage) ?? "requested table";
    return `Table '${tableName}' not found. Available tables: ${formatAvailableTableList(availableTables)}. Use get_data_catalog before writing queries.`;
  }

  return `Error executing query: ${errorMessage}`;
}
