/**
 * ClickHouse Service
 * Provides typed database query execution
 */

import { getMooseUtils, MooseUtils } from "@514labs/moose-lib";

/**
 * Execute a ClickHouse query and return typed results
 */
export async function executeQuery<T>(sql: string): Promise<T[]> {
  const moose = await getMooseUtils();
  const { client } = moose;

  const result = await (client.query.client as any).query({
    query: sql,
    format: "JSONEachRow",
  });

  return result.json();
}
