/**
 * MCP Schema Generation from QueryModel
 *
 * Auto-generates Zod schemas and request builders for MCP tools
 * directly from QueryModel metadata (filters, dimensions, metrics, columns).
 *
 * @module query-layer/model-tools
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toQuery, type Sql } from "../sqlHelpers";
import { QueryClient } from "../consumption-apis/helpers";
import type { FilterInputTypeHint, SortDir } from "./types";
// =============================================================================
// QueryModelBase — Minimal structural interface for MCP utilities
// =============================================================================

/** Filter definition shape expected by MCP utilities. */
export interface QueryModelFilter {
  operators: readonly string[];
  inputType?: FilterInputTypeHint;
  required?: true;
  description?: string;
}

/**
 * Minimal model interface consumed by createModelTool / registerModelTools.
 *
 * Any QueryModel from defineQueryModel() satisfies this structurally —
 * no explicit `implements` needed. This avoids propagating generic
 * type parameters into the MCP layer.
 */
export interface QueryModelBase {
  readonly name?: string;
  readonly description?: string;
  readonly defaults: {
    orderBy?: Array<[string, SortDir]>;
    groupBy?: string[];
    limit?: number;
    maxLimit?: number;
    dimensions?: string[];
    metrics?: string[];
    columns?: string[];
  };
  readonly filters: Record<string, QueryModelFilter>;
  readonly sortable: readonly string[];
  readonly dimensions?: Record<string, { description?: string }>;
  readonly metrics?: Record<string, { description?: string }>;
  readonly columnNames: readonly string[];
  toSql(request: Record<string, unknown>): Sql;
}

// =============================================================================
// Helpers
// =============================================================================

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function titleFromName(name: string): string {
  return name
    .replace(/^query_/, "Query ")
    .replace(/^list_/, "List ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildEnumDescription(
  metadata: Record<string, { description?: string }>,
): string | undefined {
  const entries = Object.entries(metadata);
  if (entries.length === 0) return undefined;
  const lines = entries.map(([name, def]) => {
    return def.description ? `- ${name}: ${def.description}` : `- ${name}`;
  });
  return lines.join("\n");
}

/** Map FilterInputTypeHint to a base Zod type */
function zodBaseType(inputType?: FilterInputTypeHint): z.ZodType {
  if (inputType === "number") return z.number();
  return z.string();
}

/** Scalar operators use the base type; list operators use z.array(base) */
const SCALAR_OPS = new Set([
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
]);
const LIST_OPS = new Set(["in", "notIn"]);

// =============================================================================
// Types
// =============================================================================

export interface ModelToolOptions {
  /** Filter names whose `eq` param is required (not optional). Merged with model-level `required` flags. */
  requiredFilters?: string[];
  /** Maximum limit for the tool. Falls back to model.defaults.maxLimit, then 1000. */
  maxLimit?: number;
  /** Default limit for the tool. Falls back to model.defaults.limit, then 100. */
  defaultLimit?: number;
  /** Default values applied when params are absent. Merged with model.defaults. */
  defaults?: {
    dimensions?: string[];
    metrics?: string[];
    columns?: string[];
    limit?: number;
  };
}

export interface ModelToolResult {
  /** Zod shape object to pass to server.tool() */
  schema: Record<string, z.ZodType>;
  /** Convert flat MCP params into a nested QueryRequest */
  buildRequest: (params: Record<string, unknown>) => Record<string, unknown>;
}

// =============================================================================
// createModelTool
// =============================================================================

/**
 * Generate a Zod schema and request builder from a QueryModel.
 *
 * Required filters, maxLimit, and default selections are first read from the
 * model itself (via `required: true` on filter defs and `model.defaults`).
 * The optional `options` param can override or extend any of these.
 *
 * @param model - A QueryModel instance (from defineQueryModel)
 * @param options - Optional overrides for required filters, limits, defaults
 * @returns `{ schema, buildRequest }` ready for `server.tool()`
 */
export function createModelTool(
  model: QueryModelBase,
  options: ModelToolOptions = {},
): ModelToolResult {
  // Derive required filters from model filter defs (where required === true)
  const modelRequiredFilters: string[] = [];
  for (const [filterName, filterDef] of Object.entries(model.filters)) {
    if (filterDef.required) {
      modelRequiredFilters.push(filterName);
    }
  }

  // Merge model defaults with option overrides (options win)
  const modelDefaults = model.defaults;
  const mergedDefaults = {
    dimensions: options.defaults?.dimensions ?? modelDefaults.dimensions,
    metrics: options.defaults?.metrics ?? modelDefaults.metrics,
    columns: options.defaults?.columns ?? modelDefaults.columns,
    limit: options.defaults?.limit ?? modelDefaults.limit,
  };

  const requiredFilters = [
    ...new Set([...modelRequiredFilters, ...(options.requiredFilters ?? [])]),
  ];
  const maxLimit = options.maxLimit ?? modelDefaults.maxLimit ?? 1000;
  const defaultLimit = options.defaultLimit ?? mergedDefaults.limit ?? 100;

  const requiredSet = new Set(requiredFilters);
  const schema: Record<string, z.ZodType> = {};

  // Map from MCP param name → { filterName, operator }
  const filterParamMap: Record<string, { filterName: string; op: string }> = {};

  // --- Dimensions ---
  const dimensionNames = Object.keys(model.dimensions ?? {});
  if (dimensionNames.length > 0) {
    const names = dimensionNames as [string, ...string[]];
    const desc = buildEnumDescription(model.dimensions!);
    const dimSchema = z.array(z.enum(names)).optional();
    schema.dimensions = desc ? dimSchema.describe(desc) : dimSchema;
  }

  // --- Metrics ---
  const metricNames = Object.keys(model.metrics ?? {});
  if (metricNames.length > 0) {
    const names = metricNames as [string, ...string[]];
    const desc = buildEnumDescription(model.metrics!);
    const metSchema = z.array(z.enum(names)).optional();
    schema.metrics = desc ? metSchema.describe(desc) : metSchema;
  }

  // --- Columns ---
  if (model.columnNames.length > 0) {
    const names = model.columnNames as readonly [string, ...string[]];
    schema.columns = z.array(z.enum(names)).optional();
  }

  // --- Filters ---
  for (const [filterName, filterDef] of Object.entries(model.filters)) {
    const baseType = zodBaseType(filterDef.inputType);

    for (const op of filterDef.operators) {
      // Build the MCP param name
      const snakeName = camelToSnake(filterName);
      const paramName = op === "eq" ? snakeName : `${snakeName}_${op}`;

      // Determine Zod type for this operator
      let paramType: z.ZodType;
      if (SCALAR_OPS.has(op)) {
        paramType = baseType;
      } else if (LIST_OPS.has(op)) {
        paramType = z.array(baseType);
      } else if (op === "between") {
        paramType = z.array(baseType).length(2);
      } else if (op === "isNull" || op === "isNotNull") {
        paramType = z.boolean();
      } else {
        paramType = baseType;
      }

      // Required if filter is in requiredFilters AND op is eq
      if (requiredSet.has(filterName) && op === "eq") {
        schema[paramName] =
          filterDef.description ?
            paramType.describe(filterDef.description)
          : paramType;
      } else {
        const opt = paramType.optional();
        schema[paramName] =
          filterDef.description ? opt.describe(filterDef.description) : opt;
      }

      filterParamMap[paramName] = { filterName, op };
    }
  }

  // --- Limit ---
  schema.limit = z
    .number()
    .min(1)
    .max(maxLimit)
    .default(defaultLimit)
    .optional();

  // --- buildRequest ---
  function buildRequest(
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const request: Record<string, unknown> = {};

    // Dimensions
    if (dimensionNames.length > 0) {
      request.dimensions =
        (params.dimensions as string[] | undefined) ??
        mergedDefaults.dimensions;
    }

    // Metrics
    if (metricNames.length > 0) {
      request.metrics =
        (params.metrics as string[] | undefined) ?? mergedDefaults.metrics;
    }

    // Columns
    if (model.columnNames.length > 0) {
      request.columns =
        (params.columns as string[] | undefined) ?? mergedDefaults.columns;
    }

    // Filters: reverse-map flat params to nested { [filterName]: { [op]: value } }
    const filterObj: Record<string, Record<string, unknown>> = {};
    for (const [paramName, mapping] of Object.entries(filterParamMap)) {
      const value = params[paramName];
      if (value === undefined) continue;
      if (!filterObj[mapping.filterName]) {
        filterObj[mapping.filterName] = {};
      }
      filterObj[mapping.filterName][mapping.op] = value;
    }
    if (Object.keys(filterObj).length > 0) {
      request.filters = filterObj;
    }

    // Limit
    request.limit =
      (params.limit as number | undefined) ??
      mergedDefaults.limit ??
      defaultLimit;

    return request;
  }

  return { schema, buildRequest };
}

// =============================================================================
// registerModelTools
// =============================================================================

/**
 * Register MCP tools for all models that have a `name` defined.
 *
 * Each model with a `name` property becomes an MCP tool. The library handles
 * everything: schema generation from model metadata, request building from
 * flat MCP params, SQL generation via `model.toSql()`, parameterized
 * execution with readonly enforcement, and MCP response formatting.
 *
 * Models without a `name` are silently skipped.
 *
 * @param server - McpServer instance
 * @param models - Array of QueryModel instances (from `defineQueryModel`)
 * @param queryClient - The QueryClient from `mooseUtils.client.query`.
 *   Queries are executed in readonly mode with parameterized SQL.
 *
 * @example
 * import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
 * import { getMooseUtils, MooseUtils } from "@514labs/moose-lib";
 * import { registerModelTools } from "@514labs/moose-lib";
 * import { visitsModel, usersModel } from "./models";
 *
 * const serverFactory = (mooseUtils: MooseUtils) => {
 *   const server = new McpServer({ name: "my-tools", version: "1.0.0" });
 *
 *   // One line registers all named models as MCP tools
 *   registerModelTools(server, [visitsModel, usersModel], mooseUtils.client.query);
 *
 *   return server;
 * };
 */
export function registerModelTools(
  server: McpServer,
  models: QueryModelBase[],
  queryClient: QueryClient,
): void {
  for (const model of models) {
    if (!model.name) continue;

    const toolName = model.name;
    const toolDescription = model.description ?? toolName;
    const tool = createModelTool(model);
    const defaultLimit = model.defaults?.limit ?? 100;

    server.tool(
      toolName,
      toolDescription,
      // MCP SDK's server.tool() triggers TS2589 (infinite type instantiation)
      // when given Record<string, z.ZodType>. Cast to `any` to prevent the DTS
      // generator from expanding the SDK's deeply recursive overload signatures.
      // Tracked upstream: https://github.com/modelcontextprotocol/typescript-sdk/issues/205
      tool.schema as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      { title: titleFromName(toolName) },
      async (params: Record<string, unknown>) => {
        try {
          const request = tool.buildRequest(params);
          const limit =
            typeof params.limit === "number" ? params.limit : defaultLimit;
          const sqlObj = model.toSql(request);
          const [query, queryParams] = toQuery(sqlObj);
          const result = await queryClient.client.query({
            query,
            query_params: queryParams,
            format: "JSONEachRow",
            clickhouse_settings: {
              readonly: "2",
              max_result_rows: limit.toString(),
            },
          });
          const data = await result.json();
          const rows = Array.isArray(data) ? data : [];
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ rows, rowCount: rows.length }, null, 2),
              },
            ],
          };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          const safeMsg = msg.length > 200 ? msg.slice(0, 200) + "..." : msg;
          return {
            content: [
              {
                type: "text" as const,
                text: `Error in ${toolName}: ${safeMsg}`,
              },
            ],
            isError: true,
          };
        }
      },
    );
  }
}
