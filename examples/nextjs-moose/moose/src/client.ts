import { getMooseClients, Sql, QueryClient, sql } from "@514labs/moose-lib";

async function getClickhouseClient(): Promise<QueryClient> {
  const { client } = await getMooseClients({
    host: process.env.MOOSE_CLICKHOUSE_CONFIG__HOST ?? "localhost",
    port: process.env.MOOSE_CLICKHOUSE_CONFIG__PORT ?? "18123",
    username: process.env.MOOSE_CLICKHOUSE_CONFIG__USER ?? "panda",
    password: process.env.MOOSE_CLICKHOUSE_CONFIG__PASSWORD ?? "pandapass",
    database: process.env.MOOSE_CLICKHOUSE_CONFIG__DB_NAME ?? "local",
    useSSL:
      (process.env.MOOSE_CLICKHOUSE_CONFIG__USE_SSL ?? "false") === "true",
  });

  return client.query;
}

export async function executeQuery<T>(query: Sql): Promise<T[]> {
  const queryClient = await getClickhouseClient();
  const result = await queryClient.execute(query);
  return result.json();
}

/**
 * Builds a WHERE clause from an array of SQL conditions.
 * Filters out falsy values and combines conditions with the specified operator.
 *
 * @param conditions - Array of Sql conditions (falsy values are filtered out)
 * @param operator - Operator to join conditions ('AND' or 'OR'), defaults to 'AND'
 * @returns Sql fragment with WHERE clause, or empty Sql if no conditions
 *
 * @example
 * ```typescript
 * const whereClause = buildWhereClause([
 *   sql`status = 'active'`,
 *   sql`created_at > ${startDate}`,
 *   sql`amount > 100`
 * ]);
 * // Results in: WHERE status = 'active' AND created_at > ... AND amount > 100
 * ```
 */
export function buildWhereClause(
  conditions: (Sql | null | undefined | false)[],
  operator: "AND" | "OR" = "AND",
): Sql {
  // Filter out falsy values
  const validConditions = conditions.filter((condition): condition is Sql =>
    Boolean(condition),
  );

  // If no conditions, return empty Sql
  if (validConditions.length === 0) {
    return sql``;
  }

  // Single condition
  if (validConditions.length === 1) {
    return sql`WHERE ${validConditions[0]}`;
  }

  // Multiple conditions - chain them with the operator
  let whereClause = sql`WHERE ${validConditions[0]}`;
  const operatorSql = operator === "AND" ? sql` AND ` : sql` OR `;

  for (let i = 1; i < validConditions.length; i++) {
    whereClause = sql`${whereClause}${operatorSql}${validConditions[i]}`;
  }

  return whereClause;
}
