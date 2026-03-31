/**
 * Query Model Schema — Extract JSON-serializable schema from a QueryModel.
 *
 * Generates a schema description (metrics, dimensions, filters with optional
 * distinct values, sortable fields, defaults) that frontends can use to
 * dynamically build report-builder UIs, form controls, and filter panels.
 *
 * @module query-layer/model-schema
 */

import { toQuery } from "../sqlHelpers";
import { QueryClient } from "../consumption-apis/helpers";
import type { FilterInputTypeHint } from "./types";
import type { QueryModelBase } from "./model-tools";

// =============================================================================
// Schema Types
// =============================================================================

export interface SchemaMetric {
  id: string;
  label: string;
  description?: string;
}

export interface SchemaDimension {
  id: string;
  label: string;
  description?: string;
}

export interface SchemaFilterValue {
  value: string;
  label: string;
}

export interface SchemaFilter {
  id: string;
  label: string;
  operators: string[];
  inputType?: FilterInputTypeHint;
  description?: string;
  required?: boolean;
  values?: SchemaFilterValue[];
}

export interface QueryModelSchema {
  name?: string;
  description?: string;
  metrics: SchemaMetric[];
  dimensions: SchemaDimension[];
  filters: SchemaFilter[];
  sortable: string[];
  defaults: {
    orderBy?: Array<[string, string]>;
    groupBy?: string[];
    limit?: number;
    maxLimit?: number;
    dimensions?: string[];
    metrics?: string[];
    columns?: string[];
  };
}

// =============================================================================
// Options
// =============================================================================

export interface GetModelSchemaOptions {
  /**
   * When provided, categorical filters (those with "eq" or "in" operators
   * and a matching dimension) will have their distinct values fetched from
   * ClickHouse so the UI can render toggle chips instead of text inputs.
   */
  client?: QueryClient;
}

// =============================================================================
// Implementation
// =============================================================================

const RANGE_OPS = new Set(["gt", "gte", "lt", "lte", "between"]);

/** Check whether a filter is categorical (eq/in, no range ops) */
function isCategoricalFilter(operators: readonly string[]): boolean {
  return (
    (operators.includes("eq") || operators.includes("in")) &&
    !operators.some((op) => RANGE_OPS.has(op))
  );
}

/**
 * Fetch distinct values for a categorical filter by querying the model
 * with only that dimension selected (no metrics).
 */
async function fetchDistinctValues(
  model: QueryModelBase,
  dimensionId: string,
  client: QueryClient,
): Promise<SchemaFilterValue[] | undefined> {
  try {
    const sqlObj = model.toSql({
      dimensions: [dimensionId],
      metrics: [],
    });
    const [query, queryParams] = toQuery(sqlObj);
    const result = await client.client.query({
      query,
      query_params: queryParams,
      format: "JSONEachRow",
      clickhouse_settings: { readonly: "2" },
    });
    const rows = (await result.json()) as Record<string, unknown>[];
    return rows
      .map((row) => {
        const firstKey = Object.keys(row)[0];
        const val = firstKey ? String(row[firstKey] ?? "") : "";
        return { value: val, label: val };
      })
      .filter((v) => v.value !== "")
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch (err) {
    console.warn(
      `Failed to fetch distinct values for dimension "${dimensionId}":`,
      err,
    );
    return undefined;
  }
}

/**
 * Extract a JSON-serializable schema from any QueryModel.
 *
 * Works with any model that satisfies `QueryModelBase` — no generics needed.
 * Optionally fetches distinct values for categorical filters when a
 * `QueryClient` is provided.
 *
 * @param model - A QueryModel instance (from `defineQueryModel`)
 * @param options - Optional `{ client }` for fetching categorical filter values
 * @returns Schema describing the model's metrics, dimensions, filters, and defaults
 *
 * @example
 * import { getModelSchema } from "@514labs/moose-lib";
 *
 * app.get("/schema", async (_req, res) => {
 *   const { client } = await getMooseUtils();
 *   const schema = await getModelSchema(myModel, { client: client.query });
 *   res.json(schema);
 * });
 */
export async function getModelSchema(
  model: QueryModelBase,
  options: GetModelSchemaOptions = {},
): Promise<QueryModelSchema> {
  const { client } = options;

  const metricsMap = model.metrics ?? {};
  const dimensionsMap = model.dimensions ?? {};

  const metrics: SchemaMetric[] = Object.entries(metricsMap).map(([id, m]) => ({
    id,
    label: id,
    description: m.description,
  }));

  const dimensions: SchemaDimension[] = Object.entries(dimensionsMap).map(
    ([id, d]) => ({
      id,
      label: id,
      description: d.description,
    }),
  );

  const dimensionIds = new Set(Object.keys(dimensionsMap));

  const filters: SchemaFilter[] = [];
  for (const [id, f] of Object.entries(model.filters)) {
    const operators = [...f.operators];
    const categorical = isCategoricalFilter(operators);
    const hasDimension = dimensionIds.has(id);

    let values: SchemaFilterValue[] | undefined;
    if (categorical && hasDimension && client) {
      values = await fetchDistinctValues(model, id, client);
    }

    filters.push({
      id,
      label: id,
      operators,
      inputType: f.inputType,
      description: f.description,
      ...(f.required && { required: true }),
      ...(values && { values }),
    });
  }

  return {
    name: model.name,
    description: model.description,
    metrics,
    dimensions,
    filters,
    sortable: [...model.sortable],
    defaults: { ...model.defaults },
  };
}
