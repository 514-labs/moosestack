import {
  MooseClient,
  QueryClient,
  RowPolicyOptions,
  MooseUtils,
} from "./helpers";
import { getClickhouseClient } from "../commons";
import { sql } from "../sqlHelpers";
import type { RuntimeClickHouseConfig } from "../config/runtime";
import type { RowPoliciesConfig } from "./runner";

const MOOSE_RLS_ROLE = "moose_rls_role";

export interface GetMooseUtilsOptions {
  /** Map of JWT claim names to their values for row policy scoping */
  rlsContext?: Record<string, string>;
}

/**
 * Build RowPolicyOptions from the runtime row policies config and an rlsContext.
 * The rlsContext provides claim values; the config maps claims to ClickHouse settings.
 */
function buildRowPolicyOptionsFromContext(
  config: RowPoliciesConfig,
  rlsContext: Record<string, string>,
): RowPolicyOptions {
  const clickhouse_settings: Record<string, string> = {};
  for (const [settingName, claimName] of Object.entries(config)) {
    const value = rlsContext[claimName];
    if (value !== undefined) {
      clickhouse_settings[settingName] = value;
    }
  }
  return { role: MOOSE_RLS_ROLE, clickhouse_settings };
}

// Cached utilities and initialization promise for standalone mode
let standaloneUtils: MooseUtils | null = null;
let initPromise: Promise<MooseUtils> | null = null;

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
 * **IMPORTANT**: This function is async and returns a Promise. You must await the result:
 * ```typescript
 * const moose = await getMooseUtils(); // Correct
 * const moose = getMooseUtils(); // WRONG - returns Promise, not MooseUtils!
 * ```
 *
 * Pass `{ rlsContext }` to get a scoped client that enforces ClickHouse row policies:
 * ```typescript
 * const { client, sql } = await getMooseUtils({ rlsContext: { org_id: orgId } });
 * // All queries through this client are filtered by org_id
 * ```
 *
 * @param options - Optional. Pass `{ rlsContext }` to scope queries via row policies.
 * @returns Promise resolving to MooseUtils with client and sql utilities.
 */
export async function getMooseUtils(
  options?: GetMooseUtilsOptions,
): Promise<MooseUtils> {
  // Check if running in Moose runtime
  const runtimeContext = (globalThis as any)._mooseRuntimeContext;

  if (runtimeContext) {
    if (options?.rlsContext && runtimeContext.rowPoliciesConfig) {
      // Create a new scoped QueryClient with row policy options.
      // Uses the same shared ClickHouseClient connection — no new connections.
      const rowPolicyOpts = buildRowPolicyOptionsFromContext(
        runtimeContext.rowPoliciesConfig,
        options.rlsContext,
      );
      const scopedQueryClient = new QueryClient(
        runtimeContext.clickhouseClient,
        "rls-scoped",
        rowPolicyOpts,
      );
      return {
        client: new MooseClient(
          scopedQueryClient,
          runtimeContext.temporalClient,
        ),
        sql: sql,
        jwt: runtimeContext.jwt,
      };
    }
    // No rlsContext — return the shared singleton (today's behavior)
    return {
      client: runtimeContext.client,
      sql: sql,
      jwt: runtimeContext.jwt,
    };
  }

  // Standalone mode - use cached client or create new one
  if (standaloneUtils) {
    return standaloneUtils;
  }

  // If initialization is in progress, wait for it
  if (initPromise) {
    return initPromise;
  }

  // Start initialization
  initPromise = (async () => {
    await import("../config/runtime");
    const configRegistry = (globalThis as any)._mooseConfigRegistry;

    if (!configRegistry) {
      throw new Error(
        "Moose not initialized. Ensure you're running within a Moose app " +
          "or have proper configuration set up.",
      );
    }

    const clickhouseConfig =
      await configRegistry.getStandaloneClickhouseConfig();

    const clickhouseClient = getClickhouseClient(
      toClientConfig(clickhouseConfig),
    );
    const queryClient = new QueryClient(clickhouseClient, "standalone");
    const mooseClient = new MooseClient(queryClient);

    standaloneUtils = {
      client: mooseClient,
      sql: sql,
      jwt: undefined,
    };
    return standaloneUtils;
  })();

  try {
    return await initPromise;
  } finally {
    initPromise = null;
  }
}

/**
 * @deprecated Use getMooseUtils() instead.
 * Creates a Moose client for database access.
 */
export async function getMooseClients(
  config?: Partial<RuntimeClickHouseConfig>,
): Promise<{ client: MooseClient }> {
  console.warn(
    "[DEPRECATED] getMooseClients() is deprecated. Use getMooseUtils() instead.",
  );

  // If custom config provided, create a one-off client (don't cache)
  if (config && Object.keys(config).length > 0) {
    await import("../config/runtime");
    const configRegistry = (globalThis as any)._mooseConfigRegistry;

    if (!configRegistry) {
      throw new Error(
        "Configuration registry not initialized. Ensure the Moose framework is properly set up.",
      );
    }

    const clickhouseConfig =
      await configRegistry.getStandaloneClickhouseConfig(config);

    const clickhouseClient = getClickhouseClient(
      toClientConfig(clickhouseConfig),
    );
    const queryClient = new QueryClient(clickhouseClient, "standalone");
    const mooseClient = new MooseClient(queryClient);

    return { client: mooseClient };
  }

  // No custom config - delegate to getMooseUtils
  const utils = await getMooseUtils();
  return { client: utils.client };
}
