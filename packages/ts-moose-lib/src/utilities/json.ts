import type { Column, DataType } from "../dataModels/dataModelTypes";

/**
 * Revives ISO 8601 date strings into Date objects during JSON parsing
 * This is useful for automatically converting date strings to Date objects
 *
 * @deprecated Use createColumnAwareDateReviver instead for more precise date parsing
 */
export function jsonDateReviver(key: string, value: unknown): unknown {
  const iso8601Format =
    /^([\+-]?\d{4}(?!\d{2}\b))((-?)((0[1-9]|1[0-2])(\3([12]\d|0[1-9]|3[01]))?|W([0-4]\d|5[0-2])(-?[1-7])?|(00[1-9]|0[1-9]\d|[12]\d{2}|3([0-5]\d|6[1-6])))([T\s]((([01]\d|2[0-3])((:?)[0-5]\d)?|24\:?00)([\.,]\d+(?!:))?)?(\17[0-5]\d([\.,]\d+)?)?([zZ]|([\+-])([01]\d|2[0-3]):?([0-5]\d)?)?)?)$/;

  if (typeof value === "string" && iso8601Format.test(value)) {
    return new Date(value);
  }

  return value;
}

/**
 * Checks if a DataType represents a date or datetime column
 */
function isDateType(dataType: DataType): boolean {
  if (typeof dataType === "string") {
    return (
      dataType === "Date" ||
      dataType === "Date16" ||
      dataType === "DateTime" ||
      dataType.startsWith("DateTime(")
    );
  }
  // Handle nullable wrapper
  if (
    typeof dataType === "object" &&
    dataType !== null &&
    "nullable" in dataType &&
    typeof (dataType as { nullable: DataType }).nullable !== "undefined"
  ) {
    return isDateType((dataType as { nullable: DataType }).nullable);
  }
  return false;
}

/**
 * Extracts date field names from column structures
 * Recursively handles nested objects and arrays
 */
function extractDateFieldNames(columns: Column[]): Set<string> {
  const dateFields = new Set<string>();

  for (const column of columns) {
    if (isDateType(column.data_type)) {
      dateFields.add(column.name);
    }

    // Handle nested structures
    const dataType = column.data_type;
    if (typeof dataType === "object" && dataType !== null) {
      // Handle nullable wrapper
      let unwrappedType: DataType = dataType;
      if (
        "nullable" in dataType &&
        typeof (dataType as any).nullable !== "undefined"
      ) {
        unwrappedType = (dataType as { nullable: DataType }).nullable;
      }

      // Handle nested objects
      if (
        typeof unwrappedType === "object" &&
        unwrappedType !== null &&
        "columns" in unwrappedType &&
        Array.isArray((unwrappedType as any).columns)
      ) {
        const nestedDateFields = extractDateFieldNames(
          (unwrappedType as any).columns,
        );
        for (const nestedField of nestedDateFields) {
          dateFields.add(nestedField);
        }
      }

      // Handle arrays of nested objects
      if (
        typeof unwrappedType === "object" &&
        unwrappedType !== null &&
        "elementType" in unwrappedType &&
        typeof (unwrappedType as any).elementType === "object" &&
        (unwrappedType as any).elementType !== null &&
        "columns" in (unwrappedType as any).elementType
      ) {
        const nestedDateFields = extractDateFieldNames(
          (unwrappedType as any).elementType.columns,
        );
        for (const nestedField of nestedDateFields) {
          dateFields.add(nestedField);
        }
      }
    }
  }

  return dateFields;
}

/**
 * Creates a JSON reviver function that only converts date fields based on Column metadata
 * This is more precise than jsonDateReviver which converts all ISO 8601 strings
 *
 * @param columns - Array of Column definitions from the Stream schema
 * @returns A reviver function for JSON.parse that converts only known date fields
 *
 * @example
 * ```typescript
 * const columns = stream.columnArray;
 * const reviver = createColumnAwareDateReviver(columns);
 * const data = JSON.parse(jsonString, reviver);
 * ```
 */
export function createColumnAwareDateReviver(
  columns: Column[] | undefined,
): (key: string, value: unknown) => unknown {
  // If no columns provided, fall back to no-op reviver
  if (!columns || columns.length === 0) {
    return (_key: string, value: unknown) => value;
  }

  const dateFieldNames = extractDateFieldNames(columns);

  return function reviver(key: string, value: unknown): unknown {
    // Check if this field name is a known date field
    if (dateFieldNames.has(key) && typeof value === "string") {
      try {
        const date = new Date(value);
        // Validate it's a valid date
        if (!isNaN(date.getTime())) {
          return date;
        }
      } catch {
        // If date parsing fails, return original value
      }
    }

    return value;
  };
}
