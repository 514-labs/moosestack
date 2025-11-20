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
 * Path segment for traversing nested objects
 */
type PathSegment = string | number;

/**
 * Builds a list of paths to date fields in the schema
 * Each path is an array of keys to traverse to reach the date field
 */
function buildDateFieldPaths(
  columns: Column[],
  basePath: PathSegment[] = [],
): PathSegment[][] {
  const datePaths: PathSegment[][] = [];

  for (const column of columns) {
    const currentPath = [...basePath, column.name];

    if (isDateType(column.data_type, column.annotations)) {
      datePaths.push(currentPath);
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
        const nestedPaths = buildDateFieldPaths(
          (unwrappedType as any).columns,
          currentPath,
        );
        datePaths.push(...nestedPaths);
      }

      // Handle arrays of nested objects
      // For arrays, we use a special marker '*' to indicate "all array elements"
      if (
        typeof unwrappedType === "object" &&
        unwrappedType !== null &&
        "elementType" in unwrappedType &&
        typeof (unwrappedType as any).elementType === "object" &&
        (unwrappedType as any).elementType !== null &&
        "columns" in (unwrappedType as any).elementType
      ) {
        const nestedPaths = buildDateFieldPaths(
          (unwrappedType as any).elementType.columns,
          [...currentPath, "*"],
        );
        datePaths.push(...nestedPaths);
      }
    }
  }

  return datePaths;
}

/**
 * Mutates an object by converting string values to Date objects at specified paths
 *
 * @param obj - The object to mutate
 * @param path - Array of keys/indices to traverse
 * @param index - Current position in the path
 */
function mutateDateAtPath(
  obj: any,
  path: PathSegment[],
  index: number = 0,
): void {
  if (!obj || typeof obj !== "object") {
    return;
  }

  if (index >= path.length) {
    return;
  }

  const segment = path[index];
  const isLastSegment = index === path.length - 1;

  // Handle array wildcard
  if (segment === "*") {
    if (Array.isArray(obj)) {
      for (const item of obj) {
        mutateDateAtPath(item, path, index + 1);
      }
    }
    return;
  }

  // Handle regular property access
  if (segment in obj) {
    if (isLastSegment) {
      // Convert to Date if it's a string
      const value = obj[segment];
      if (typeof value === "string") {
        try {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            obj[segment] = date;
          }
        } catch {
          // If date parsing fails, leave as is
        }
      }
    } else {
      // Recurse deeper
      mutateDateAtPath(obj[segment], path, index + 1);
    }
  }
}

/**
 * Converts date string fields to Date objects based on Column schema
 * Mutates the object in place for performance
 *
 * @param data - The parsed JSON object to mutate
 * @param columns - Column definitions from the Stream schema
 *
 * @example
 * ```typescript
 * const data = JSON.parse(jsonString);
 * convertDatesFromColumns(data, stream.columnArray);
 * // data now has Date objects where the schema specifies date fields
 * ```
 */
export function convertDatesFromColumns(
  data: any,
  columns: Column[] | undefined,
): void {
  if (!columns || columns.length === 0 || !data) {
    return;
  }

  const datePaths = buildDateFieldPaths(columns);

  for (const path of datePaths) {
    mutateDateAtPath(data, path);
  }
}
