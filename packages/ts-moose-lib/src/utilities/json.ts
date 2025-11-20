import type { Column, DataType } from "../dataModels/dataModelTypes";

/**
 * Revives ISO 8601 date strings into Date objects during JSON parsing
 * This is useful for automatically converting date strings to Date objects
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
 * Checks if a DataType represents a datetime column (not just date)
 * AND if the column should be parsed from string to Date at runtime
 *
 * Note: Date and Date16 are date-only types and should remain as strings.
 * Only DateTime types are candidates for parsing to JavaScript Date objects.
 */
function isDateType(dataType: DataType, annotations: [string, any][]): boolean {
  // Check if this is marked as a string-based date (from typia.tags.Format)
  // If so, it should remain as a string, not be parsed to Date
  if (
    annotations.some(([key, value]) => key === "stringDate" && value === true)
  ) {
    return false;
  }

  if (typeof dataType === "string") {
    // Only DateTime types should be parsed to Date objects
    // Date and Date16 are date-only and should stay as strings
    return dataType === "DateTime" || dataType.startsWith("DateTime(");
  }
  // Handle nullable wrapper
  if (
    typeof dataType === "object" &&
    dataType !== null &&
    "nullable" in dataType &&
    typeof (dataType as { nullable: DataType }).nullable !== "undefined"
  ) {
    return isDateType(
      (dataType as { nullable: DataType }).nullable,
      annotations,
    );
  }
  return false;
}

/**
 * Type of handling to apply to a field during parsing
 */
export type Handling = "parseDate"; // | "parseBigInt" - to be added later

/**
 * Recursive tuple array structure representing field handling operations
 * Each entry is [fieldName, handling]:
 * - handling is Handling[] for leaf fields that need operations applied
 * - handling is FieldHandlings for nested objects/arrays (auto-applies to array elements)
 */
export type FieldHandlings = [string, Handling[] | FieldHandlings][];

/**
 * Recursively builds field handlings from column definitions
 *
 * @param columns - Array of Column definitions
 * @returns Tuple array of field handlings
 */
function buildFieldHandlings(columns: Column[]): FieldHandlings {
  const handlings: FieldHandlings = [];

  for (const column of columns) {
    const dataType = column.data_type;

    // Check if this is a date field that should be converted
    if (isDateType(dataType, column.annotations)) {
      handlings.push([column.name, ["parseDate"]]);
      continue;
    }

    // Handle nested structures
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
        const nestedHandlings = buildFieldHandlings(
          (unwrappedType as any).columns,
        );
        if (nestedHandlings.length > 0) {
          handlings.push([column.name, nestedHandlings]);
        }
        continue;
      }

      // Handle arrays with nested columns
      // The handlings will be auto-applied to each array element at runtime
      if (
        typeof unwrappedType === "object" &&
        unwrappedType !== null &&
        "elementType" in unwrappedType &&
        typeof (unwrappedType as any).elementType === "object" &&
        (unwrappedType as any).elementType !== null &&
        "columns" in (unwrappedType as any).elementType
      ) {
        const nestedHandlings = buildFieldHandlings(
          (unwrappedType as any).elementType.columns,
        );
        if (nestedHandlings.length > 0) {
          handlings.push([column.name, nestedHandlings]);
        }
        continue;
      }
    }
  }

  return handlings;
}

/**
 * Applies a handling operation to a field value
 *
 * @param value - The value to handle
 * @param handling - The handling operation to apply
 * @returns The handled value
 */
function applyHandling(value: any, handling: Handling): any {
  if (handling === "parseDate") {
    if (typeof value === "string") {
      try {
        const date = new Date(value);
        return !isNaN(date.getTime()) ? date : value;
      } catch {
        return value;
      }
    }
  }
  return value;
}

/**
 * Recursively mutates an object by applying field handlings
 *
 * @param obj - The object to mutate
 * @param handlings - The field handlings to apply
 */
function applyFieldHandlings(obj: any, handlings: FieldHandlings): void {
  if (!obj || typeof obj !== "object") {
    return;
  }

  for (const [fieldName, handling] of handlings) {
    if (!(fieldName in obj)) {
      continue;
    }

    if (Array.isArray(handling)) {
      // Check if it's Handling[] (leaf) or FieldHandlings (nested)
      if (handling.length > 0 && typeof handling[0] === "string") {
        // It's Handling[] - apply operations to this field
        const operations = handling as Handling[];
        for (const operation of operations) {
          obj[fieldName] = applyHandling(obj[fieldName], operation);
        }
      } else {
        // It's FieldHandlings - recurse into nested structure
        const nestedHandlings = handling as FieldHandlings;
        const fieldValue = obj[fieldName];

        if (Array.isArray(fieldValue)) {
          // Auto-apply to each array element
          for (const item of fieldValue) {
            applyFieldHandlings(item, nestedHandlings);
          }
        } else if (fieldValue && typeof fieldValue === "object") {
          // Apply to nested object
          applyFieldHandlings(fieldValue, nestedHandlings);
        }
      }
    }
  }
}

/**
 * Pre-builds field handlings from column schema for efficient reuse
 *
 * @param columns - Column definitions from the Stream schema
 * @returns Field handlings tuple array, or undefined if no columns
 *
 * @example
 * ```typescript
 * const fieldHandlings = buildFieldHandlingsFromColumns(stream.columnArray);
 * // Reuse fieldHandlings for every message
 * ```
 */
export function buildFieldHandlingsFromColumns(
  columns: Column[] | undefined,
): FieldHandlings | undefined {
  if (!columns || columns.length === 0) {
    return undefined;
  }
  const handlings = buildFieldHandlings(columns);
  return handlings.length > 0 ? handlings : undefined;
}

/**
 * Applies field handlings to parsed data
 * Mutates the object in place for performance
 *
 * @param data - The parsed JSON object to mutate
 * @param fieldHandlings - Pre-built field handlings from buildFieldHandlingsFromColumns
 *
 * @example
 * ```typescript
 * const fieldHandlings = buildFieldHandlingsFromColumns(stream.columnArray);
 * const data = JSON.parse(jsonString);
 * applyFieldHandlingsToData(data, fieldHandlings);
 * // data now has transformations applied per the field handlings
 * ```
 */
export function applyFieldHandlingsToData(
  data: any,
  fieldHandlings: FieldHandlings | undefined,
): void {
  if (!fieldHandlings || !data) {
    return;
  }

  applyFieldHandlings(data, fieldHandlings);
}
