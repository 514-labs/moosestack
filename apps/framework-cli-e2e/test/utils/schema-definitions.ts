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
  // Engine test tables
  {
    tableName: "MergeTreeTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Float64" },
      { name: "category", type: "String" },
      { name: "version", type: "Float64" },
      { name: "isDeleted", type: "Bool" },
    ],
  },
  {
    tableName: "MergeTreeTestExpr",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Float64" },
      { name: "category", type: "String" },
      { name: "version", type: "Float64" },
      { name: "isDeleted", type: "Bool" },
    ],
    orderBy: ["id", "timestamp"],
  },
  {
    tableName: "ReplacingMergeTreeBasic",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Float64" },
      { name: "category", type: "String" },
      { name: "version", type: "Float64" },
      { name: "isDeleted", type: "Bool" },
    ],
  },
  {
    tableName: "ReplacingMergeTreeVersion",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Float64" },
      { name: "category", type: "String" },
      { name: "version", type: "Float64" },
      { name: "isDeleted", type: "Bool" },
    ],
  },
  {
    tableName: "ReplacingMergeTreeSoftDelete",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Float64" },
      { name: "category", type: "String" },
      { name: "version", type: "Float64" },
      { name: "isDeleted", type: "Bool" },
    ],
  },
  {
    tableName: "SummingMergeTreeTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Float64" },
      { name: "category", type: "String" },
      { name: "version", type: "Float64" },
      { name: "isDeleted", type: "Bool" },
    ],
  },
  {
    tableName: "SummingMergeTreeWithColumnsTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Float64" },
      { name: "category", type: "String" },
      { name: "version", type: "Float64" },
      { name: "isDeleted", type: "Bool" },
    ],
  },
  {
    tableName: "AggregatingMergeTreeTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Float64" },
      { name: "category", type: "String" },
      { name: "version", type: "Float64" },
      { name: "isDeleted", type: "Bool" },
    ],
  },
  {
    tableName: "ReplicatedMergeTreeTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Float64" },
      { name: "category", type: "String" },
      { name: "version", type: "Float64" },
      { name: "isDeleted", type: "Bool" },
    ],
  },
  {
    tableName: "ReplicatedMergeTreeCloudTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Float64" },
      { name: "category", type: "String" },
      { name: "version", type: "Float64" },
      { name: "isDeleted", type: "Bool" },
    ],
  },
  {
    tableName: "ReplicatedReplacingMergeTreeTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Float64" },
      { name: "category", type: "String" },
      { name: "version", type: "Float64" },
      { name: "isDeleted", type: "Bool" },
    ],
  },
  {
    tableName: "ReplicatedReplacingSoftDeleteTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Float64" },
      { name: "category", type: "String" },
      { name: "version", type: "Float64" },
      { name: "isDeleted", type: "Bool" },
    ],
  },
  {
    tableName: "ReplicatedAggregatingMergeTreeTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Float64" },
      { name: "category", type: "String" },
      { name: "version", type: "Float64" },
      { name: "isDeleted", type: "Bool" },
    ],
  },
  {
    tableName: "ReplicatedSummingMergeTreeTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Float64" },
      { name: "category", type: "String" },
      { name: "version", type: "Float64" },
      { name: "isDeleted", type: "Bool" },
    ],
  },
  {
    tableName: "SampleByTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Float64" },
      { name: "category", type: "String" },
      { name: "version", type: "Float64" },
      { name: "isDeleted", type: "Bool" },
    ],
    orderByExpression: "cityHash64(id)",
    sampleByExpression: "cityHash64(id)",
  },
  // Type test tables
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
  // Geometry tables
  {
    tableName: "GeoTypes",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "point", type: "Point" },
      { name: "ring", type: /(Ring|Array\(Point\))/ },
      { name: "lineString", type: /(LineString|Array\(Point\))/ },
      {
        name: "multiLineString",
        type: /(MultiLineString|Array\(Array\(Point\)\))/,
      },
      { name: "polygon", type: /(Polygon|Array\(Array\(Point\)\))/ },
      {
        name: "multiPolygon",
        type: /(MultiPolygon|Array\(Array\(Array\(Point\)\)\))/,
      },
    ],
  },
  // SimpleAggregateFunction test table
  {
    tableName: "SimpleAggTest",
    columns: [
      { name: "date_stamp", type: "Date" },
      { name: "table_name", type: "String" },
      { name: "row_count", type: /SimpleAggregateFunction\(sum, UInt64\)/ },
      { name: "max_value", type: /SimpleAggregateFunction\(max, Float64\)/ },
      { name: "min_value", type: /SimpleAggregateFunction\(min, Float64\)/ },
      {
        name: "last_updated",
        type: /SimpleAggregateFunction\(anyLast, DateTime\('UTC'\)/,
      },
    ],
  },
  // NonDeclaredType test table
  {
    tableName: "NonDeclaredType",
    columns: [
      { name: "id", type: "String" },
      { name: "yes", type: "Bool" },
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
  // Engine test tables
  {
    tableName: "MergeTreeTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Int64" },
      { name: "category", type: "String" },
      { name: "version", type: "Int64" },
      { name: "is_deleted", type: "Bool" },
    ],
  },
  {
    tableName: "MergeTreeTestExpr",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Int64" },
      { name: "category", type: "String" },
      { name: "version", type: "Int64" },
      { name: "is_deleted", type: "Bool" },
    ],
    orderBy: ["id", "timestamp"],
  },
  {
    tableName: "ReplacingMergeTreeBasic",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Int64" },
      { name: "category", type: "String" },
      { name: "version", type: "Int64" },
      { name: "is_deleted", type: "Bool" },
    ],
  },
  {
    tableName: "ReplacingMergeTreeVersion",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Int64" },
      { name: "category", type: "String" },
      { name: "version", type: "Int64" },
      { name: "is_deleted", type: "Bool" },
    ],
  },
  {
    tableName: "ReplacingMergeTreeSoftDelete",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Int64" },
      { name: "category", type: "String" },
      { name: "version", type: "Int64" },
      { name: "is_deleted", type: "Bool" },
    ],
  },
  {
    tableName: "SummingMergeTreeTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Int64" },
      { name: "category", type: "String" },
      { name: "version", type: "Int64" },
      { name: "is_deleted", type: "Bool" },
    ],
  },
  {
    tableName: "AggregatingMergeTreeTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Int64" },
      { name: "category", type: "String" },
      { name: "version", type: "Int64" },
      { name: "is_deleted", type: "Bool" },
    ],
  },
  {
    tableName: "ReplicatedMergeTreeTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Int64" },
      { name: "category", type: "String" },
      { name: "version", type: "Int64" },
      { name: "is_deleted", type: "Bool" },
    ],
  },
  {
    tableName: "ReplicatedMergeTreeCloudTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Int64" },
      { name: "category", type: "String" },
      { name: "version", type: "Int64" },
      { name: "is_deleted", type: "Bool" },
    ],
  },
  {
    tableName: "ReplicatedReplacingMergeTreeTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Int64" },
      { name: "category", type: "String" },
      { name: "version", type: "Int64" },
      { name: "is_deleted", type: "Bool" },
    ],
  },
  {
    tableName: "ReplicatedReplacingSoftDeleteTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Int64" },
      { name: "category", type: "String" },
      { name: "version", type: "Int64" },
      { name: "is_deleted", type: "Bool" },
    ],
  },
  {
    tableName: "ReplicatedAggregatingMergeTreeTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Int64" },
      { name: "category", type: "String" },
      { name: "version", type: "Int64" },
      { name: "is_deleted", type: "Bool" },
    ],
  },
  {
    tableName: "ReplicatedSummingMergeTreeTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Int64" },
      { name: "category", type: "String" },
      { name: "version", type: "Int64" },
      { name: "is_deleted", type: "Bool" },
    ],
  },
  {
    tableName: "SampleByTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "value", type: "Int64" },
      { name: "category", type: "String" },
      { name: "version", type: "Int64" },
      { name: "is_deleted", type: "Bool" },
    ],
    orderByExpression: "cityHash64(id)",
    sampleByExpression: "cityHash64(id)",
  },
  // Type test tables
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
  // Geometry tables
  {
    tableName: "GeoTypes",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "point", type: "Point" },
      { name: "ring", type: /(Ring|Array\(Point\))/ },
      { name: "line_string", type: /(LineString|Array\(Point\))/ },
      {
        name: "multi_line_string",
        type: /(MultiLineString|Array\(Array\(Point\)\))/,
      },
      { name: "polygon", type: /(Polygon|Array\(Array\(Point\)\))/ },
      {
        name: "multi_polygon",
        type: /(MultiPolygon|Array\(Array\(Array\(Point\)\)\))/,
      },
    ],
  },
  // SimpleAggregateFunction test table
  {
    tableName: "SimpleAggTest",
    columns: [
      { name: "date_stamp", type: "Date" },
      { name: "table_name", type: "String" },
      { name: "row_count", type: /SimpleAggregateFunction\(sum, UInt64\)/ },
      { name: "max_value", type: /SimpleAggregateFunction\(max, Int64\)/ },
      { name: "min_value", type: /SimpleAggregateFunction\(min, Int64\)/ },
      {
        name: "last_updated",
        type: /SimpleAggregateFunction\(anyLast, DateTime\('UTC'\)/,
      },
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
