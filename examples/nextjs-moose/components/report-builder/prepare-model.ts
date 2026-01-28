/**
 * Server-side helper to prepare a QueryModel for the client.
 *
 * This converts the QueryModel's metadata into a serializable format
 * that can be passed to client components.
 */

import type { ReportModel } from "./use-report";
import type {
  FieldOption,
  FilterMeta,
  FilterInputType,
  FilterSelectOption,
} from "./types";

// =============================================================================
// Types
// =============================================================================

/**
 * Filter override options for customizing filter UI.
 */
export interface FilterOverride {
  /** Override the input type */
  inputType?: FilterInputType;
  /** Options for select/multiselect filters */
  options?: FilterSelectOption[];
  /** Override the label */
  label?: string;
  /** Override the description */
  description?: string;
}

/**
 * Field override options for customizing dimension/metric UI.
 */
export interface FieldOverride {
  /** Override the label */
  label?: string;
  /** Override the description */
  description?: string;
}

/**
 * Options for prepareModel.
 */
export interface PrepareModelOptions {
  /** Filter overrides by filter name */
  filters?: Record<string, FilterOverride>;
  /** Dimension overrides by dimension name */
  dimensions?: Record<string, FieldOverride>;
  /** Metric overrides by metric name */
  metrics?: Record<string, FieldOverride>;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert camelCase/snake_case to Title Case.
 */
function toTitleCase(name: string): string {
  // Handle snake_case
  if (name.includes("_")) {
    return name
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");
  }
  // Handle camelCase
  return name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

/**
 * Infer input type from filter name and operators.
 */
function inferInputType(
  name: string,
  operators: readonly string[],
  column?: string,
): FilterInputType {
  const namesToCheck = [name.toLowerCase(), column?.toLowerCase() ?? ""];

  // Date patterns
  if (
    namesToCheck.some(
      (n) =>
        n.includes("date") ||
        n.includes("time") ||
        n.includes("timestamp") ||
        n.includes("created") ||
        n.includes("updated"),
    )
  ) {
    return "date";
  }

  // Number patterns
  if (
    namesToCheck.some(
      (n) =>
        n.includes("amount") ||
        n.includes("count") ||
        n.includes("price") ||
        n.includes("total") ||
        n.includes("quantity"),
    )
  ) {
    return "number";
  }

  // If has 'in' operator, likely multiselect
  if (operators.includes("in") || operators.includes("notIn")) {
    return "select"; // Default to select, user can override to multiselect
  }

  // Range operators without other context → number
  const hasOnlyRangeOps = operators.every(
    (op) =>
      op === "gte" ||
      op === "lte" ||
      op === "gt" ||
      op === "lt" ||
      op === "between",
  );
  if (hasOnlyRangeOps) {
    return "number";
  }

  return "text";
}

// =============================================================================
// Main Function
// =============================================================================

/**
 * Prepare a QueryModel for use with useReport.
 *
 * Converts the model's dimensions, metrics, and filters into a serializable
 * ReportModel that can be passed to client components.
 *
 * @param queryModel - The QueryModel instance (e.g., statsModel)
 * @param options - Optional overrides for labels, input types, etc.
 * @returns Serializable ReportModel for useReport
 *
 * @example
 * // In a Server Component
 * import { prepareModel } from "@/components/report-builder";
 * import { statsModel } from "moose";
 *
 * const model = prepareModel(statsModel, {
 *   filters: {
 *     status: {
 *       inputType: "select",
 *       options: [
 *         { value: "active", label: "Active" },
 *         { value: "completed", label: "Completed" },
 *       ],
 *     },
 *   },
 * });
 *
 * // Pass to client component
 * <ReportPage model={model} />
 */
export function prepareModel<
  TModel extends {
    readonly dimensions?: Record<
      string,
      { as?: string; alias?: string } | unknown
    >;
    readonly metrics?: Record<
      string,
      { as?: string; alias?: string } | unknown
    >;
    readonly filters?: Record<
      string,
      {
        column?: string;
        operators: readonly string[];
        inputType?: FilterInputType;
      }
    >;
    readonly dimensionNames?: readonly string[];
    readonly metricNames?: readonly string[];
  },
>(queryModel: TModel, options: PrepareModelOptions = {}): ReportModel {
  const {
    filters: filterOverrides = {},
    dimensions: dimOverrides = {},
    metrics: metricOverrides = {},
  } = options;

  // ---------------------------------------------------------------------------
  // Build Dimensions
  // ---------------------------------------------------------------------------

  const dimensions: FieldOption[] = [];

  if (queryModel.dimensions) {
    for (const [name, def] of Object.entries(queryModel.dimensions)) {
      const override = dimOverrides[name];
      const typedDef = def as { as?: string; alias?: string } | undefined;
      const alias = typedDef?.as ?? typedDef?.alias;

      dimensions.push({
        id: name,
        label: override?.label ?? toTitleCase(name),
        description: override?.description ?? toTitleCase(name).toLowerCase(),
        dataKey: alias && alias !== name ? alias : undefined,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Build Metrics
  // ---------------------------------------------------------------------------

  const metrics: FieldOption[] = [];

  if (queryModel.metrics) {
    for (const [name, def] of Object.entries(queryModel.metrics)) {
      const override = metricOverrides[name];
      const typedDef = def as { as?: string; alias?: string } | undefined;
      const alias = typedDef?.as ?? typedDef?.alias;

      metrics.push({
        id: name,
        label: override?.label ?? toTitleCase(name),
        description: override?.description ?? toTitleCase(name).toLowerCase(),
        dataKey: alias && alias !== name ? alias : undefined,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Build Filters
  // ---------------------------------------------------------------------------

  const filters: FilterMeta[] = [];

  if (queryModel.filters) {
    for (const [name, def] of Object.entries(queryModel.filters)) {
      const override = filterOverrides[name];
      const operators = [...def.operators]; // Convert readonly to mutable

      // Determine input type: override > model definition > inferred
      const inputType =
        override?.inputType ??
        def.inputType ??
        inferInputType(name, operators, def.column);

      filters.push({
        id: name,
        label: override?.label ?? toTitleCase(name),
        description:
          override?.description ??
          `Filter by ${toTitleCase(name).toLowerCase()}`,
        operators,
        inputType,
        options: override?.options,
      });
    }
  }
  return {
    dimensions,
    metrics,
    filters,
  };
}
