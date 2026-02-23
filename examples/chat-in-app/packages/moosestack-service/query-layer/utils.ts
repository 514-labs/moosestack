import type { FilterInputTypeHint } from "./types";

/**
 * Derive FilterInputTypeHint from a ClickHouse column data_type string.
 *
 * Maps ClickHouse types to appropriate UI input types:
 * - DateTime64, DateTime, Date → "date"
 * - Int*, UInt*, Float*, Decimal → "number"
 * - Enum* → "select"
 * - String, FixedString → "text"
 *
 * @param dataType - The column's data_type (string or nullable wrapper)
 * @returns The appropriate FilterInputTypeHint
 */
export function deriveInputTypeFromDataType(
  dataType: string | { nullable: unknown } | unknown,
): FilterInputTypeHint {
  // Unwrap nullable types
  let typeStr: string;
  if (typeof dataType === "string") {
    typeStr = dataType;
  } else if (
    dataType &&
    typeof dataType === "object" &&
    "nullable" in dataType
  ) {
    return deriveInputTypeFromDataType(
      (dataType as { nullable: unknown }).nullable,
    );
  } else {
    return "text";
  }

  const lower = typeStr.toLowerCase();

  // Date/DateTime types
  if (lower.startsWith("datetime") || lower.startsWith("date")) {
    return "date";
  }

  // Numeric types
  if (
    lower.startsWith("int") ||
    lower.startsWith("uint") ||
    lower.startsWith("float") ||
    lower.startsWith("decimal")
  ) {
    return "number";
  }

  // Enum types → select
  if (lower.startsWith("enum")) {
    return "select";
  }

  // Boolean → select
  if (lower === "bool" || lower === "boolean") {
    return "select";
  }

  // Default to text
  return "text";
}
