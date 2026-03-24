import {
  MooseClient,
  MOOSE_RLS_SETTING_PREFIX,
  MOOSE_RLS_USER,
  QueryClient,
  MooseUtils,
  RowPoliciesConfig,
  RowPolicyOptions,
  buildRowPolicyOptionsFromClaims,
} from "./helpers";
import { getClickhouseClient } from "../commons";
import { sql } from "../sqlHelpers";
import { getSelectRowPolicies } from "../dmv2/registry";
import type { RuntimeClickHouseConfig } from "../config/runtime";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ClickHouseClient } from "@clickhouse/client";
import type { JWTPayload } from "jose";

// ---------------------------------------------------------------------------
// Exported types & helpers for runner.ts
// ---------------------------------------------------------------------------

/**
 * Per-request context stored via AsyncLocalStorage.
 * Set by the runtime (runner.ts) before invoking WebApp handlers so that
 * getMooseUtils() can auto-scope queries with row policies from the JWT.
 *
 * `rowPolicyOpts` carries pre-built ClickHouse settings (setting-keyed).
 * This avoids a redundant round-trip through claim-keyed rlsContext.
 */
interface RequestContext {
  rowPolicyOpts?: RowPolicyOptions;
  jwt?: JWTPayload;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Run a callback with per-request context (rowPolicyOpts, jwt).
 * Used by the runtime to wrap WebApp handler invocations so that
 * getMooseUtils() inside the handler auto-scopes with row policies.
 */
export function runWithRequestContext<T>(
  context: RequestContext,
  fn: () => T,
): T {
  return requestContextStorage.run(context, fn);
}

export interface GetMooseUtilsOptions {
  /** Map of JWT claim names to their values for row policy scoping */
  rlsContext?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// RLS helpers
// ---------------------------------------------------------------------------

/**
 * Detect whether the argument is a legacy HTTP request object (old API).
 * Legacy callers passed an IncomingMessage or framework request which has
 * HTTP-specific properties like `method`, `url`, and `headers`.
 * Plain option objects (including `{}`) are NOT legacy requests.
 */
function isLegacyRequestArg(arg: unknown): boolean {
  if (arg === null || typeof arg !== "object") return false;
  const obj = arg as Record<string, unknown>;
  return "method" in obj || "url" in obj || "headers" in obj;
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

// ---------------------------------------------------------------------------
// Module-level cached state
// ---------------------------------------------------------------------------

// Cached utilities and initialization promise for standalone mode
let standaloneUtils: MooseUtils | null = null;
let initPromise: Promise<MooseUtils> | null = null;
let standaloneRlsClient: ClickHouseClient | null = null;
let standaloneClickhouseConfig: RuntimeClickHouseConfig | null = null;

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

// ---------------------------------------------------------------------------
// getMooseUtils — the main entry point
// ---------------------------------------------------------------------------

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
  if (options !== undefined && isLegacyRequestArg(options)) {
    console.warn(
      "[DEPRECATED] getMooseUtils(req) no longer requires a request parameter. " +
        "Use getMooseUtils() instead, or getMooseUtils({ rlsContext }) for row policies.",
    );
    options = undefined;
  }

  // Check if running in Moose runtime
  const runtimeContext = (globalThis as any)._mooseRuntimeContext;
  if (runtimeContext) {
    return resolveRuntimeUtils(runtimeContext, options);
  }

  // Standalone path — outside Moose (cron job, separate server, ad-hoc script)
  await ensureStandaloneInit();

  if (options?.rlsContext) {
    return createStandaloneRlsUtils(options.rlsContext);
  }

  return standaloneUtils!;
}

// ---------------------------------------------------------------------------
// Private: runtime path
// ---------------------------------------------------------------------------

/**
 * Resolve MooseUtils when running inside the Moose runtime.
 *
 * RLS priority:
 *   1. Explicit rlsContext from the caller
 *   2. Pre-built RowPolicyOptions from the request (WebApp path via AsyncLocalStorage)
 *   3. No RLS — return the shared singleton
 */
function resolveRuntimeUtils(
  runtimeContext: any,
  options?: GetMooseUtilsOptions,
): MooseUtils {
  const reqCtx = requestContextStorage.getStore();
  const jwt = reqCtx?.jwt ?? runtimeContext.jwt;

  let rowPolicyOpts: RowPolicyOptions | undefined;
  if (options?.rlsContext) {
    if (!runtimeContext.rowPoliciesConfig) {
      throw new Error(
        "rlsContext was provided but no row policies are configured. " +
          "Define at least one SelectRowPolicy before using rlsContext.",
      );
    }
    rowPolicyOpts = buildRowPolicyOptionsFromClaims(
      runtimeContext.rowPoliciesConfig,
      options.rlsContext,
    );
  } else {
    rowPolicyOpts = reqCtx?.rowPolicyOpts;
  }

  if (rowPolicyOpts) {
    const rlsClient =
      runtimeContext.rlsClickhouseClient ?? runtimeContext.clickhouseClient;
    const scopedQueryClient = new QueryClient(
      rlsClient,
      "rls-scoped",
      rowPolicyOpts,
    );
    return {
      client: new MooseClient(scopedQueryClient, runtimeContext.temporalClient),
      sql: sql,
      jwt,
    };
  }

  // No RLS — return the shared singleton
  return {
    client: runtimeContext.client,
    sql: sql,
    jwt,
  };
}

// ---------------------------------------------------------------------------
// Private: standalone path
// ---------------------------------------------------------------------------

/** Lazy-initialize the standalone ClickHouse client (once). */
async function ensureStandaloneInit(): Promise<void> {
  if (standaloneUtils) return;

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
      standaloneClickhouseConfig = clickhouseConfig;

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

/** Build RLS-scoped MooseUtils for standalone mode. */
function createStandaloneRlsUtils(
  rlsContext: Record<string, string>,
): MooseUtils {
  const rowPoliciesConfig = getRowPoliciesConfigFromRegistry();
  if (!rowPoliciesConfig) {
    throw new Error(
      "rlsContext was provided but no SelectRowPolicy primitives are registered. " +
        "Define at least one SelectRowPolicy before using rlsContext.",
    );
  }

  if (!standaloneRlsClient && standaloneClickhouseConfig) {
    standaloneRlsClient = getClickhouseClient(
      toClientConfig({
        ...standaloneClickhouseConfig,
        username: standaloneClickhouseConfig.rlsUser ?? MOOSE_RLS_USER,
        password:
          standaloneClickhouseConfig.rlsPassword ??
          standaloneClickhouseConfig.password,
      }),
    );
  }

  const rowPolicyOpts = buildRowPolicyOptionsFromClaims(
    rowPoliciesConfig,
    rlsContext,
  );
  const rlsClient = standaloneRlsClient ?? standaloneUtils!.client.query.client;
  const scopedQueryClient = new QueryClient(
    rlsClient,
    "rls-scoped",
    rowPolicyOpts,
  );
  return {
    client: new MooseClient(scopedQueryClient),
    sql: sql,
    jwt: undefined,
  };
}

// ---------------------------------------------------------------------------
// Deprecated
// ---------------------------------------------------------------------------

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
