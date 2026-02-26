/**
 * MCP Schema Generation from QueryModel
 *
 * Auto-generates Zod schemas and request builders for MCP tools
 * directly from QueryModel metadata (filters, dimensions, metrics, columns).
 *
 * @module query-layer/mcp-utils
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Sql } from "../sqlHelpers";
import type { FilterInputTypeHint, SortDir } from "./types";
import type { QueryModel } from "./query-model";

// =============================================================================
// QueryModelBase — Minimal structural interface for MCP utilities
// =============================================================================

/** Filter definition shape expected by MCP utilities. */
export interface QueryModelFilter {
  operators: readonly string[];
  inputType?: FilterInputTypeHint;
  required?: true;
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
  readonly dimensionNames: readonly string[];
  readonly metricNames: readonly string[];
  readonly columnNames: readonly string[];
  toSql(request: Record<string, unknown>): Sql;
}

// Compile-time check: QueryModel must satisfy QueryModelBase.
// If QueryModel drifts, _AssertCompatible resolves to `never` and the
// conditional assignment on _Check produces a type error.
type _AssertCompatible =
  QueryModel<any, any, any, any, any, any, any> extends QueryModelBase ? true
  : never;
const _assertCompatible: _AssertCompatible = true as _AssertCompatible;
void _assertCompatible;

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

  const requiredFilters = options.requiredFilters ?? modelRequiredFilters;
  const maxLimit = options.maxLimit ?? modelDefaults.maxLimit ?? 1000;
  const defaultLimit = options.defaultLimit ?? mergedDefaults.limit ?? 100;

  const requiredSet = new Set(requiredFilters);
  const schema: Record<string, z.ZodType> = {};

  // Map from MCP param name → { filterName, operator }
  const filterParamMap: Record<string, { filterName: string; op: string }> = {};

  // --- Dimensions ---
  if (model.dimensionNames.length > 0) {
    const names = model.dimensionNames as readonly [string, ...string[]];
    schema.dimensions = z.array(z.enum(names)).optional();
  }

  // --- Metrics ---
  if (model.metricNames.length > 0) {
    const names = model.metricNames as readonly [string, ...string[]];
    schema.metrics = z.array(z.enum(names)).optional();
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
        schema[paramName] = paramType;
      } else {
        schema[paramName] = paramType.optional();
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
    if (model.dimensionNames.length > 0) {
      request.dimensions =
        (params.dimensions as string[] | undefined) ??
        mergedDefaults.dimensions;
    }

    // Metrics
    if (model.metricNames.length > 0) {
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
 * @param server - McpServer instance
 * @param models - Array of QueryModel instances (only those with `name` are registered)
 * @param executeQueryModel - Callback to execute a model query and return MCP result
 */
export function registerModelTools(
  server: McpServer,
  models: QueryModelBase[],
  executeQueryModel: (
    model: Pick<QueryModelBase, "toSql">,
    request: Record<string, unknown>,
    limit: number,
  ) => Promise<{ content: { type: "text"; text: string }[] }>,
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
      // when given Record<string, z.ZodType>. Cast to any at the SDK boundary.
      tool.schema as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      { title: titleFromName(toolName) },
      async (params: Record<string, unknown>) => {
        try {
          const request = tool.buildRequest(params);
          return await executeQueryModel(
            model,
            request,
            (params.limit as number | undefined) ?? defaultLimit,
          );
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
