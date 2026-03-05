import {
  MooseClient,
  MOOSE_RLS_SETTING_PREFIX,
  QueryClient,
  MooseUtils,
  RowPoliciesConfig,
  buildRowPolicyOptionsFromClaims,
} from "./helpers";
import { getClickhouseClient } from "../commons";
import { sql } from "../sqlHelpers";
import { getSelectRowPolicies } from "../dmv2/registry";
import type { RuntimeClickHouseConfig } from "../config/runtime";

export interface GetMooseUtilsOptions {
  /** Map of JWT claim names to their values for row policy scoping */
  rlsContext?: Record<string, string>;
}

/**
 * Detect whether the argument is the new options object or a legacy request (old API).
 * The new API uses `{ rlsContext }`. Anything else is treated as the deprecated `req` param.
 */
function isNewOptionsArg(arg: unknown): boolean {
  if (arg === undefined) return true;
  if (arg === null || typeof arg !== "object") return false;
  return "rlsContext" in (arg as Record<string, unknown>);
}

/**
 * Build a RowPoliciesConfig from the registered SelectRowPolicy primitives.
 * Returns undefined if no policies are registered.
 */
function getRowPoliciesConfigFromRegistry(): RowPoliciesConfig | undefined {
  const policies = getSelectRowPolicies();
  if (policies.size === 0) return undefined;
  const config: RowPoliciesConfig = Object.create(null);
  for (const policy of policies.values()) {
    config[`${MOOSE_RLS_SETTING_PREFIX}${policy.config.column}`] =
      policy.config.claim;
  }
  return config;
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
 *                  DEPRECATED: Passing a request object is no longer needed and will be ignored.
 * @returns Promise resolving to MooseUtils with client and sql utilities.
 */
export async function getMooseUtils(
  options?: GetMooseUtilsOptions | any,
): Promise<MooseUtils> {
  // Backward compatibility: detect old getMooseUtils(req) usage
  if (options !== undefined && !isNewOptionsArg(options)) {
    console.warn(
      "[DEPRECATED] getMooseUtils(req) no longer requires a request parameter. " +
        "Use getMooseUtils() instead, or getMooseUtils({ rlsContext }) for row policies.",
    );
    options = undefined;
  }

  // Check if running in Moose runtime
  const runtimeContext = (globalThis as any)._mooseRuntimeContext;

  if (runtimeContext) {
    if (options?.rlsContext) {
      if (!runtimeContext.rowPoliciesConfig) {
        throw new Error(
          "rlsContext was provided but no row policies are configured. " +
            "Define at least one SelectRowPolicy before using rlsContext.",
        );
      }
      // Create a new scoped QueryClient with row policy options.
      // Uses the same shared ClickHouseClient connection — no new connections.
      const rowPolicyOpts = buildRowPolicyOptionsFromClaims(
        runtimeContext.rowPoliciesConfig,
        options.rlsContext,
        "rlsContext",
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
    // No rlsContext — return the shared singleton
    return {
      client: runtimeContext.client,
      sql: sql,
      jwt: runtimeContext.jwt,
    };
  }

  // Standalone mode - initialize base client if needed
  if (!standaloneUtils) {
    if (!initPromise) {
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
        await initPromise;
      } finally {
        initPromise = null;
      }
    } else {
      await initPromise;
    }
  }

  // If rlsContext is provided, create a scoped client using the shared connection
  if (options?.rlsContext) {
    const rowPoliciesConfig = getRowPoliciesConfigFromRegistry();
    if (!rowPoliciesConfig) {
      throw new Error(
        "rlsContext was provided but no SelectRowPolicy primitives are registered. " +
          "Define at least one SelectRowPolicy before using rlsContext.",
      );
    }
    const rowPolicyOpts = buildRowPolicyOptionsFromClaims(
      rowPoliciesConfig,
      options.rlsContext,
      "rlsContext",
    );
    // Reuse the underlying ClickHouseClient from the cached QueryClient
    const baseQueryClient = standaloneUtils!.client.query;
    const scopedQueryClient = new QueryClient(
      baseQueryClient.client,
      "rls-scoped",
      rowPolicyOpts,
    );
    return {
      client: new MooseClient(scopedQueryClient),
      sql: sql,
      jwt: undefined,
    };
  }

  return standaloneUtils!;
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
