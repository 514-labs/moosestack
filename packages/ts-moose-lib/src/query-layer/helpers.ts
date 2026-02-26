/**
 * Composable helpers that leverage moose-lib table metadata to reduce
 * boilerplate in QueryModel definitions.
 *
 * @module query-layer/helpers
 */

import { sql } from "../sqlHelpers";
import type { Column, DataType } from "../dataModels/dataModelTypes";
import type { OlapTable } from "../dmv2";
import type {
  DimensionDef,
  ColumnDef,
  ModelFilterDef,
  FilterInputTypeHint,
} from "./types";

// --- Utility: snake_case → camelCase ---

function toCamelCase(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// --- deriveInputTypeFromDataType ---

/**
 * Derive FilterInputTypeHint from a ClickHouse column data_type.
 *
 * Maps ClickHouse types to appropriate UI input types:
 * - DateTime64, DateTime, Date → "date"
 * - Int*, UInt*, Float*, Decimal → "number"
 * - Enum* → "select"
 * - String, FixedString → "text"
 */
export function deriveInputTypeFromDataType(
  dataType: DataType,
): FilterInputTypeHint {
  if (typeof dataType === "string") {
    const lower = dataType.toLowerCase();

    if (lower.startsWith("datetime") || lower.startsWith("date")) {
      return "date";
    }
    if (
      lower.startsWith("int") ||
      lower.startsWith("uint") ||
      lower.startsWith("float") ||
      lower.startsWith("decimal")
    ) {
      return "number";
    }
    if (lower.startsWith("enum")) {
      return "select";
    }
    if (lower === "bool" || lower === "boolean") {
      return "select";
    }
    return "text";
  }

  if ("nullable" in dataType) {
    return deriveInputTypeFromDataType(dataType.nullable);
  }
  if ("name" in dataType && "values" in dataType) {
    return "select";
  }
  if ("elementType" in dataType) {
    return "text";
  }
  return "text";
}

// --- timeDimensions ---

type DefaultTimePeriods = {
  day: DimensionDef;
  month: DimensionDef;
  week: DimensionDef;
};

/**
 * Generate day/month/week dimension definitions from a date column reference.
 *
 * @param dateColumn - A Column reference from `Table.columns.some_date`
 * @returns `{ day, month, week }` dimension definitions
 *
 * @example
 * dimensions: {
 *   status: { column: "status" },
 *   ...timeDimensions(VisitsTable.columns.start_date),
 * }
 */
export function timeDimensions(dateColumn: Column): DefaultTimePeriods;
export function timeDimensions(
  dateColumn: Column,
  options: { periods: string[] },
): Record<string, DimensionDef>;
export function timeDimensions(
  dateColumn: Column,
  options?: { periods?: string[] },
): DefaultTimePeriods | Record<string, DimensionDef> {
  const periods = options?.periods ?? ["day", "month", "week"];

  const fnMap: Record<string, (col: Column) => DimensionDef> = {
    day: (col) => ({ expression: sql`toDate(${col})`, as: "day" }),
    month: (col) => ({ expression: sql`toStartOfMonth(${col})`, as: "month" }),
    week: (col) => ({ expression: sql`toStartOfWeek(${col})`, as: "week" }),
  };

  const supported = Object.keys(fnMap);
  const result: Record<string, DimensionDef> = {};
  for (const period of periods) {
    const factory = fnMap[period];
    if (!factory) {
      throw new Error(
        `Unknown time period '${period}'. Supported: ${supported.join(", ")}`,
      );
    }
    result[period] = factory(dateColumn);
  }

  return result;
}

// --- Table field helpers ---

interface TableFieldOptions {
  /** Only include these column names (snake_case as in the table) */
  include?: string[];
  /** Exclude these column names */
  exclude?: string[];
  /** Convert snake_case keys to camelCase (default: true) */
  camelCase?: boolean;
}

/**
 * Generate ColumnDef records from a table's columnArray metadata.
 *
 * @example
 * columns: {
 *   ...columnsFromTable(VisitsTable, { include: ["id", "name", "status"] }),
 *   firstName: { join: "user", column: "first_name" },
 * }
 */
export function columnsFromTable<T>(
  table: OlapTable<T>,
  options?: TableFieldOptions,
): Record<string, ColumnDef<T>> {
  const { include, exclude, camelCase = true } = options ?? {};
  const result: Record<string, ColumnDef<T>> = {};

  for (const col of table.columnArray) {
    const colName = String(col.name);

    if (include && !include.includes(colName)) continue;
    if (exclude && exclude.includes(colName)) continue;

    const key = camelCase ? toCamelCase(colName) : colName;
    result[key] = { column: colName as keyof T & string };
  }

  return result;
}

/**
 * Generate ModelFilterDef records from a table's columnArray metadata.
 *
 * **Conservative defaults**: all filters get `["eq"]` operators only.
 * Consumers widen operators explicitly via spread overrides.
 *
 * @example
 * filters: {
 *   ...filtersFromTable(VisitsTable, { include: ["studio_id", "start_date", "status"] }),
 *   status: { column: "status", operators: ["eq", "ne", "in"] as const },
 * }
 */
export function filtersFromTable<T>(
  table: OlapTable<T>,
  options?: TableFieldOptions,
): Record<string, ModelFilterDef<T, keyof T>> {
  const { include, exclude, camelCase = true } = options ?? {};
  const result: Record<string, ModelFilterDef<T, keyof T>> = {};

  for (const col of table.columnArray) {
    const colName = String(col.name);

    if (include && !include.includes(colName)) continue;
    if (exclude && exclude.includes(colName)) continue;

    const key = camelCase ? toCamelCase(colName) : colName;
    result[key] = {
      column: colName as keyof T,
      operators: ["eq"] as const,
      inputType: deriveInputTypeFromDataType(col.data_type),
    };
  }

  return result;
}
