import { ExpectedTableSchema } from "./database-utils";

// ============ TYPESCRIPT TEMPLATE SCHEMA DEFINITIONS ============

/**
 * Expected schema for TypeScript templates - basic tables
 */
export const TYPESCRIPT_BASIC_SCHEMAS: ExpectedTableSchema[] = [
  {
    tableName: "Bar",
    columns: [
      { name: "primaryKey", type: "String" },
      { name: "utcTimestamp", type: /DateTime\('UTC'\)/ },
      { name: "hasText", type: "Bool" },
      { name: "textLength", type: "Float64" }, // ClickHouse uses Float64 for numbers
    ],
  },
  {
    tableName: "FooDeadLetter",
    columns: [
      // Based on actual ClickHouse output, DeadLetter tables have different structure
      { name: "originalRecord", type: "JSON" }, // ClickHouse uses JSON type for complex data
      { name: "errorType", type: "String" },
      { name: "failedAt", type: /DateTime\('UTC'\)/ },
      { name: "errorMessage", type: "String" },
      { name: "source", type: "LowCardinality(String)" }, // ClickHouse optimizes with LowCardinality
    ],
  },
];

/**
 * Expected schema for TypeScript test templates - comprehensive test tables
 */
export const TYPESCRIPT_TEST_SCHEMAS: ExpectedTableSchema[] = [
  ...TYPESCRIPT_BASIC_SCHEMAS,
  {
    tableName: "BasicTypes",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "stringField", type: "String" },
      { name: "numberField", type: "Float64" },
      { name: "booleanField", type: "Bool" },
      { name: "optionalString", type: "Nullable(String)", nullable: true },
      { name: "nullableNumber", type: "Nullable(Float64)", nullable: true },
    ],
  },
  {
    tableName: "SimpleArrays",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "stringArray", type: /Array\(String\)/ },
      { name: "numberArray", type: /Array\(Float64\)/ },
      { name: "booleanArray", type: /Array\(Bool\)/ },
      { name: "optionalStringArray", type: /Array\(String\)/ }, // ClickHouse doesn't make optional arrays nullable
      { name: "mixedOptionalArray", type: /Array\(String\)/ },
    ],
  },
  {
    tableName: "NestedObjects",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      // Nested objects are typically flattened or stored as Nested columns in ClickHouse
      { name: "address", type: /Nested\(.*\)/ },
      { name: "metadata", type: /Nested\(.*\)/ },
    ],
  },
  {
    tableName: "ArraysOfObjects",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "users", type: /Nested\(.*\)/ },
      { name: "transactions", type: /Nested\(.*\)/ },
    ],
  },
  {
    tableName: "DeeplyNestedArrays",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      // Multi-dimensional arrays
      { name: "matrix2D", type: /Array\(Array\(Float64\)\)/ },
      { name: "matrix3D", type: /Array\(Array\(Array\(Float64\)\)\)/ },
      { name: "matrix4D", type: /Array\(Array\(Array\(Array\(Float64\)\)\)\)/ },
      { name: "complexNested", type: /Nested\(.*\)/ },
    ],
  },
  {
    tableName: "MixedComplexTypes",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "events", type: /Nested\(.*\)/ },
      { name: "nestedData", type: /Nested\(.*\)/ },
      { name: "complexMatrix", type: /Nested\(.*\)/ },
    ],
  },
  {
    tableName: "EdgeCases",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "emptyStringArray", type: /Array\(String\)/ },
      { name: "emptyObjectArray", type: /Nested\(.*\)/ },
      { name: "nullableString", type: "Nullable(String)", nullable: true },
      { name: "nullableNumber", type: "Nullable(Float64)", nullable: true },
      { name: "moderateNesting", type: /Nested\(.*\)/ },
      { name: "complexArray", type: /Nested\(.*\)/ },
    ],
  },
  {
    tableName: "OptionalNestedTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      // Arrays of objects with optional fields - should become Nested type with nullable inner fields
      {
        name: "nested",
        type: /Nested\(name Nullable\(String\), age Nullable\(Float64\)\)/,
      },
      // Optional field with ClickHouse default - should have default value
      { name: "other", type: "Nullable(String)", nullable: true },
    ],
  },
];

// ============ PYTHON TEMPLATE SCHEMA DEFINITIONS ============

/**
 * Expected schema for Python templates - basic tables
 */
export const PYTHON_BASIC_SCHEMAS: ExpectedTableSchema[] = [
  {
    tableName: "Bar",
    columns: [
      { name: "primary_key", type: "String" },
      { name: "utc_timestamp", type: /DateTime\('UTC'\)/ },
      { name: "baz", type: /Enum8\(.*\)/ }, // Enum becomes Enum8 in ClickHouse
      { name: "has_text", type: "Bool" },
      { name: "text_length", type: "Int64" }, // ClickHouse uses Int64 for integers
    ],
  },
];

/**
 * Expected schema for Python test templates - comprehensive test tables
 */
export const PYTHON_TEST_SCHEMAS: ExpectedTableSchema[] = [
  ...PYTHON_BASIC_SCHEMAS,
  {
    tableName: "AllTypes",
    columns: [
      { name: "id", type: "String" },
      { name: "ts", type: /DateTime\('UTC'\)/ },

      // Signed
      { name: "int8_col", type: "Int8" },
      { name: "int16_col", type: "Int16" },
      { name: "int32_col", type: "Int32" },
      { name: "int64_col", type: "Int64" },

      // Unsigned
      { name: "uint8_col", type: "UInt8" },
      { name: "uint16_col", type: "UInt16" },
      { name: "uint32_col", type: "UInt32" },
      { name: "uint64_col", type: "UInt64" },

      // Float and Decimal
      { name: "float32_col", type: "Float32" },
      { name: "decimal_col", type: /Decimal\(10, 2\)/ },

      // LowCardinality
      { name: "lowcard_col", type: /LowCardinality\(String\)/ },

      // UUID
      { name: "uuid_col", type: "UUID" },

      // Date and DateTime64
      { name: "date_col", type: "Date32" },
      { name: "dt64_col", type: /DateTime64\(3\)/ },

      // IP
      { name: "ipv4_col", type: "IPv4" },
      { name: "ipv6_col", type: "IPv6" },

      // Map
      { name: "map_col", type: /Map\(String, Int32\)/ },

      // Named Tuple
      { name: "named_tuple_col", type: /Tuple\(lat Float64, lng Float64\)/ },

      // JSON
      { name: "json_col", type: "JSON" },

      // Nullable
      { name: "optional_uint32", type: "Nullable(UInt32)", nullable: true },
      { name: "optional_str_with_default", type: "Nullable(String)", nullable: true },
    ],
  },
  {
    tableName: "BasicTypes",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "string_field", type: "String" },
      { name: "number_field", type: "Float64" },
      { name: "boolean_field", type: "Bool" },
      { name: "optional_string", type: "Nullable(String)", nullable: true },
      { name: "nullable_number", type: "Nullable(Float64)", nullable: true },
    ],
  },
  {
    tableName: "SimpleArrays",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "string_array", type: /Array\(String\)/ },
      { name: "number_array", type: /Array\(Float64\)/ },
      { name: "boolean_array", type: /Array\(Bool\)/ },
      { name: "optional_string_array", type: /Array\(String\)/ }, // ClickHouse doesn't make optional arrays nullable
      { name: "mixed_optional_array", type: /Array\(String\)/ },
    ],
  },
  {
    tableName: "NestedObjects",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "address", type: /Nested\(.*\)/ },
      { name: "metadata", type: /Nested\(.*\)/ },
    ],
  },
  {
    tableName: "ArraysOfObjects",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "users", type: /Nested\(.*\)/ },
      { name: "transactions", type: /Nested\(.*\)/ },
    ],
  },
  {
    tableName: "DeeplyNestedArrays",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      // Multi-dimensional arrays
      { name: "matrix_2d", type: /Array\(Array\(Float64\)\)/ },
      { name: "matrix_3d", type: /Array\(Array\(Array\(Float64\)\)\)/ },
      {
        name: "matrix_4d",
        type: /Array\(Array\(Array\(Array\(Float64\)\)\)\)/,
      },
      { name: "complex_nested", type: /Nested\(.*\)/ },
    ],
  },
  {
    tableName: "MixedComplexTypes",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "events", type: /Nested\(.*\)/ },
      { name: "nested_data", type: /Nested\(.*\)/ },
      { name: "complex_matrix", type: /Nested\(.*\)/ },
    ],
  },
  {
    tableName: "EdgeCases",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "empty_string_array", type: /Array\(String\)/ },
      { name: "empty_object_array", type: /Nested\(.*\)/ },
      { name: "nullable_string", type: "Nullable(String)", nullable: true },
      { name: "nullable_number", type: "Nullable(Float64)", nullable: true },
      { name: "moderate_nesting", type: /Nested\(.*\)/ },
      { name: "complex_array", type: /Nested\(.*\)/ },
    ],
  },
  {
    tableName: "OptionalNestedTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      // Arrays of objects with optional fields - should become Nested type with nullable inner fields
      {
        name: "nested",
        type: /Nested\(name Nullable\(String\), age Nullable\(Float64\)\)/,
      },
      // Optional field with ClickHouse default - should have default value
      { name: "other", type: "Nullable(String)", nullable: true },
    ],
  },
];

// ============ HELPER FUNCTIONS ============

/**
 * Get expected schemas based on template type
 */
export const getExpectedSchemas = (
  language: "typescript" | "python",
  isTestsVariant: boolean,
): ExpectedTableSchema[] => {
  if (language === "typescript") {
    return isTestsVariant ? TYPESCRIPT_TEST_SCHEMAS : TYPESCRIPT_BASIC_SCHEMAS;
  } else {
    return isTestsVariant ? PYTHON_TEST_SCHEMAS : PYTHON_BASIC_SCHEMAS;
  }
};

/**
 * Get table names that should exist for a given template
 */
export const getExpectedTableNames = (
  language: "typescript" | "python",
  isTestsVariant: boolean,
): string[] => {
  const schemas = getExpectedSchemas(language, isTestsVariant);
  return schemas.map((schema) => schema.tableName);
};
