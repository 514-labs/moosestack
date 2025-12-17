import { MooseClient, QueryClient, MooseUtils } from "./helpers";
import { getClickhouseClient } from "../commons";
import { sql } from "../sqlHelpers";
import type { RuntimeClickHouseConfig } from "../config/runtime";

// Cached utilities for standalone mode
let standaloneUtils: MooseUtils | null = null;

// Convert config to client config format
const toClientConfig = (config: {
  host: string;
  port: string;
  username: string;
  password: string;
  database: string;
  useSSL: boolean;
}) => ({
  ...config,
  useSSL: config.useSSL ? "true" : "false",
});

/**
 * Get Moose utilities for database access and SQL queries.
 * Works in both Moose runtime and standalone contexts.
 *
 * @param req - DEPRECATED: Request parameter is no longer needed and will be ignored.
 * @returns Promise resolving to MooseUtils with client and sql utilities.
 *
 * @example
 * ```typescript
 * const { client, sql } = await getMooseUtils();
 * const result = await client.query.execute(sql`SELECT * FROM table`);
 * ```
 */
export async function getMooseUtils(req?: any): Promise<MooseUtils> {
  // Deprecation warning if req passed
  if (req !== undefined) {
    console.warn(
      "[DEPRECATED] getMooseUtils(req) no longer requires a request parameter. " +
        "Use getMooseUtils() instead.",
    );
  }

  // Check if running in Moose runtime
  const runtimeContext = (globalThis as any)._mooseRuntimeContext;

  if (runtimeContext) {
    // In Moose runtime - use existing connections
    return {
      client: runtimeContext.client,
      sql: sql,
    };
  }

  // Standalone mode - use cached client or create new one
  if (standaloneUtils) {
    return standaloneUtils;
  }

  await import("../config/runtime");
  const configRegistry = (globalThis as any)._mooseConfigRegistry;

  if (!configRegistry) {
    throw new Error(
      "Moose not initialized. Ensure you're running within a Moose app " +
        "or have proper configuration set up.",
    );
  }

  const clickhouseConfig = await configRegistry.getStandaloneClickhouseConfig();

  const clickhouseClient = getClickhouseClient(
    toClientConfig(clickhouseConfig),
  );
  const queryClient = new QueryClient(clickhouseClient, "standalone");
  const mooseClient = new MooseClient(queryClient);

  standaloneUtils = {
    client: mooseClient,
    sql: sql,
  };

  return standaloneUtils;
}

export async function getMooseClients(
  config?: Partial<RuntimeClickHouseConfig>,
): Promise<{ client: MooseClient }> {
  await import("../config/runtime");
  const configRegistry = (globalThis as any)._mooseConfigRegistry;

  if (!configRegistry) {
    throw new Error(
      "Configuration registry not initialized. Ensure the Moose framework is properly set up.",
    );
  }

  const clickhouseConfig =
    await configRegistry.getStandaloneClickhouseConfig(config);

  const clickhouseClient = getClickhouseClient({
    username: clickhouseConfig.username,
    password: clickhouseConfig.password,
    database: clickhouseConfig.database,
    useSSL: clickhouseConfig.useSSL ? "true" : "false",
    host: clickhouseConfig.host,
    port: clickhouseConfig.port,
  });

  const queryClient = new QueryClient(clickhouseClient, "standalone");
  const mooseClient = new MooseClient(queryClient);

  return { client: mooseClient };
}
