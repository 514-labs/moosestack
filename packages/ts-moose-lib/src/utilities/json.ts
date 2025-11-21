import type {
  Column,
  DataType,
  Nested,
  ArrayType,
} from "../dataModels/dataModelTypes";

/**
 * Annotation key used to mark DateTime fields that should remain as strings
 * rather than being parsed into Date objects at runtime.
 */
export const STRING_DATE_ANNOTATION = "stringDate";

/**
 * Type guard to check if a DataType is a nullable wrapper
 */
function isNullableType(dt: DataType): dt is { nullable: DataType } {
  return (
    typeof dt === "object" &&
    dt !== null &&
    "nullable" in dt &&
    typeof dt.nullable !== "undefined"
  );
}

/**
 * Type guard to check if a DataType is a Nested type
 */
function isNestedType(dt: DataType): dt is Nested {
  return (
    typeof dt === "object" &&
    dt !== null &&
    "columns" in dt &&
    Array.isArray(dt.columns)
  );
}

/**
 * Type guard to check if a DataType is an ArrayType
 */
function isArrayType(dt: DataType): dt is ArrayType {
  return (
    typeof dt === "object" &&
    dt !== null &&
    "elementType" in dt &&
    typeof dt.elementType !== "undefined"
  );
}

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
    annotations.some(
      ([key, value]) => key === STRING_DATE_ANNOTATION && value === true,
    )
  ) {
    return false;
  }

  if (typeof dataType === "string") {
    // Only DateTime types should be parsed to Date objects
    // Date and Date16 are date-only and should stay as strings
    return dataType === "DateTime" || dataType.startsWith("DateTime(");
  }
  // Handle nullable wrapper
  if (isNullableType(dataType)) {
    return isDateType(dataType.nullable, annotations);
  }
  return false;
}

/**
 * Type of mutation to apply to a field during parsing
 */
export type Mutation = "parseDate"; // | "parseBigInt" - to be added later

/**
 * Recursive tuple array structure representing field mutation operations
 * Each entry is [fieldName, mutation]:
 * - mutation is Mutation[] for leaf fields that need operations applied
 * - mutation is FieldMutations for nested objects/arrays (auto-applies to array elements)
 */
export type FieldMutations = [string, Mutation[] | FieldMutations][];

/**
 * Recursively builds field mutations from column definitions
 *
 * @param columns - Array of Column definitions
 * @returns Tuple array of field mutations
 */
function buildFieldMutations(columns: Column[]): FieldMutations {
  const mutations: FieldMutations = [];

  for (const column of columns) {
    const dataType = column.data_type;

    // Check if this is a date field that should be converted
    if (isDateType(dataType, column.annotations)) {
      mutations.push([column.name, ["parseDate"]]);
      continue;
    }

    // Handle nested structures
    if (typeof dataType === "object" && dataType !== null) {
      // Handle nullable wrapper
      let unwrappedType: DataType = dataType;
      if (isNullableType(dataType)) {
        unwrappedType = dataType.nullable;
      }

      // Handle nested objects
      if (isNestedType(unwrappedType)) {
        const nestedMutations = buildFieldMutations(unwrappedType.columns);
        if (nestedMutations.length > 0) {
          mutations.push([column.name, nestedMutations]);
        }
        continue;
      }

      // Handle arrays with nested columns
      // The mutations will be auto-applied to each array element at runtime
      if (isArrayType(unwrappedType)) {
        const elementType = unwrappedType.elementType;
        if (isNestedType(elementType)) {
          const nestedMutations = buildFieldMutations(elementType.columns);
          if (nestedMutations.length > 0) {
            mutations.push([column.name, nestedMutations]);
          }
          continue;
        }
      }
    }
  }

  return mutations;
}

/**
 * Applies a mutation operation to a field value
 *
 * @param value - The value to handle
 * @param mutation - The mutation operation to apply
 * @returns The handled value
 */
function applyMutation(value: any, mutation: Mutation): any {
  if (mutation === "parseDate") {
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
 * Recursively mutates an object by applying field mutations
 *
 * @param obj - The object to mutate
 * @param mutations - The field mutations to apply
 */
function applyFieldMutations(obj: any, mutations: FieldMutations): void {
  if (!obj || typeof obj !== "object") {
    return;
  }

  for (const [fieldName, mutation] of mutations) {
    if (!(fieldName in obj)) {
      continue;
    }

    if (Array.isArray(mutation)) {
      // Check if it's Mutation[] (leaf) or FieldMutations (nested)
      if (mutation.length > 0 && typeof mutation[0] === "string") {
        // It's Mutation[] - apply operations to this field
        const operations = mutation as Mutation[];
        for (const operation of operations) {
          obj[fieldName] = applyMutation(obj[fieldName], operation);
        }
      } else {
        // It's FieldMutations - recurse into nested structure
        const nestedMutations = mutation as FieldMutations;
        const fieldValue = obj[fieldName];

        if (Array.isArray(fieldValue)) {
          // Auto-apply to each array element
          for (const item of fieldValue) {
            applyFieldMutations(item, nestedMutations);
          }
        } else if (fieldValue && typeof fieldValue === "object") {
          // Apply to nested object
          applyFieldMutations(fieldValue, nestedMutations);
        }
      }
    }
  }
}

/**
 * Pre-builds field mutations from column schema for efficient reuse
 *
 * @param columns - Column definitions from the Stream schema
 * @returns Field mutations tuple array, or undefined if no columns
 *
 * @example
 * ```typescript
 * const fieldMutations = buildFieldMutationsFromColumns(stream.columnArray);
 * // Reuse fieldMutations for every message
 * ```
 */
export function buildFieldMutationsFromColumns(
  columns: Column[] | undefined,
): FieldMutations | undefined {
  if (!columns || columns.length === 0) {
    return undefined;
  }
  const mutations = buildFieldMutations(columns);
  return mutations.length > 0 ? mutations : undefined;
}

/**
 * Applies field mutations to parsed data
 * Mutates the object in place for performance
 *
 * @param data - The parsed JSON object to mutate
 * @param fieldMutations - Pre-built field mutations from buildFieldMutationsFromColumns
 *
 * @example
 * ```typescript
 * const fieldMutations = buildFieldMutationsFromColumns(stream.columnArray);
 * const data = JSON.parse(jsonString);
 * mutateParsedJson(data, fieldMutations);
 * // data now has transformations applied per the field mutations
 * ```
 */
export function mutateParsedJson(
  data: any,
  fieldMutations: FieldMutations | undefined,
): void {
  if (!fieldMutations || !data) {
    return;
  }

  applyFieldMutations(data, fieldMutations);
}
