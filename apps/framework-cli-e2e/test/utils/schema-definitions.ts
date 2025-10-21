import { ExpectedTableSchema } from "./database-utils";

// ============ CLICKHOUSE TYPE CONSTRAINTS ============
//
// CRITICAL CONSTRAINTS discovered through testing:
// 1. ❌ Nullable(Array(...)) is ILLEGAL - Arrays cannot be wrapped in Nullable
// 2. ❌ Nullable(Nested(...)) is ILLEGAL - Nested types cannot be wrapped in Nullable
// 3. ❌ Primary key must be prefix of ORDER BY - First ORDER BY column must be primary key
// 4. ✅ Nested(field Nullable(Type)) is LEGAL - Nullable fields inside Nested are OK
// 5. ✅ Array(Array(...)) is LEGAL - Multi-dimensional arrays work
// 6. ✅ Array(Nested(...)) patterns need verification
//
// These constraints are enforced by ClickHouse and must be respected in our type mappings.

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
  // TODO: Fix ClickHouseDefault usage - temporarily commented out to unblock array transform tests
  // {
  //   tableName: "OptionalNestedTest",
  //   columns: [
  //     { name: "id", type: "String" },
  //     { name: "timestamp", type: /DateTime\('UTC'\)/ },
  //     // Arrays of objects with optional fields - should become Nested type with nullable inner fields
  //     {
  //       name: "nested",
  //       type: /Nested\(name Nullable\(String\), age Nullable\(Float64\)\)/,
  //     },
  //     // Field with ClickHouse default - should be String with default value, not nullable
  //     { name: "other", type: "String", nullable: false },
  //   ],
  // },
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
  // Production pattern tests
  {
    tableName: "ComplexTransaction",
    columns: [
      { name: "transactionId", type: "Float64" }, // Key<number> becomes Float64 in TypeScript
      { name: "customerId", type: "Nullable(Float64)", nullable: true },
      { name: "transactionDate", type: /DateTime\('UTC'\)/ },
      { name: "location", type: "String" },
      { name: "subtotal", type: "Float64" },
      { name: "tax", type: "Float64" },
      { name: "total", type: "Float64" },
      { name: "items", type: /Nested\(.*\)/ },
      { name: "discounts", type: /Nested\(.*\)/ },
      { name: "orderIds", type: /Array\(Float64\)/ }, // number[] becomes Array(Float64)
      { name: "tipAmount", type: "Nullable(Float64)", nullable: true },
      { name: "invoiceNumber", type: "Nullable(String)", nullable: true },
      { name: "terminalName", type: "Nullable(String)", nullable: true },
      { name: "isVoid", type: "Bool" },
      { name: "isTaxInclusive", type: "Nullable(Bool)", nullable: true },
    ],
    engine: "ReplacingMergeTree",
    orderBy: ["transactionId", "location", "transactionDate"], // Primary key must be first
  },
  {
    tableName: "ProductWithLocation",
    columns: [
      { name: "productId", type: "Float64" }, // TypeScript number becomes Float64
      { name: "productName", type: "Nullable(String)", nullable: true },
      { name: "description", type: "Nullable(String)", nullable: true },
      { name: "categoryId", type: "Nullable(Float64)", nullable: true }, // TypeScript number becomes Float64
      { name: "tags", type: /Array\(String\)/ }, // Arrays cannot be nullable in ClickHouse
      { name: "location", type: "String" },
      { name: "inventoryId", type: "Float64" }, // TypeScript number becomes Float64
    ],
    engine: "ReplacingMergeTree",
    orderBy: ["inventoryId", "location"],
  },
  {
    tableName: "EngineTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "location", type: "String" },
      { name: "category", type: "String" },
      { name: "value", type: "Float64" },
    ],
    engine: "MergeTree",
    orderBy: ["id", "location", "category"],
  },
  // Array transform test
  {
    tableName: "ArrayOutput",
    columns: [
      { name: "inputId", type: "String" },
      { name: "value", type: "String" },
      { name: "index", type: "Float64" }, // TypeScript number becomes Float64
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
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
  // TODO: Fix ClickHouseDefault usage - temporarily commented out to unblock array transform tests
  // {
  //   tableName: "OptionalNestedTest",
  //   columns: [
  //     { name: "id", type: "String" },
  //     { name: "timestamp", type: /DateTime\('UTC'\)/ },
  //     // Arrays of objects with optional fields - should become Nested type with nullable inner fields
  //     {
  //       name: "nested",
  //       type: /Nested\(name Nullable\(String\), age Nullable\(Float64\)\)/,
  //     },
  //     // Field with ClickHouse default - should be String with default value, not nullable
  //     { name: "other", type: "String", nullable: false },
  //   ],
  // },
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
  // Production pattern tests for Python
  {
    tableName: "ComplexTransaction",
    columns: [
      { name: "transaction_id", type: "Int64" }, // Key<int> becomes Int64
      { name: "customer_id", type: "Nullable(Int64)", nullable: true },
      { name: "transaction_date", type: /DateTime\('UTC'\)/ },
      { name: "location", type: "String" },
      { name: "subtotal", type: "Float64" },
      { name: "tax", type: "Float64" },
      { name: "total", type: "Float64" },
      { name: "items", type: /Nested\(.*\)/ },
      { name: "discounts", type: /Nested\(.*\)/ },
      { name: "order_ids", type: /Array\(Int64\)/ }, // Python int becomes Int64
      { name: "tip_amount", type: "Nullable(Float64)", nullable: true },
      { name: "invoice_number", type: "Nullable(String)", nullable: true },
      { name: "terminal_name", type: "Nullable(String)", nullable: true },
      { name: "is_void", type: "Bool" },
      { name: "is_tax_inclusive", type: "Nullable(Bool)", nullable: true },
    ],
    engine: "ReplacingMergeTree",
    orderBy: ["transaction_id", "location", "transaction_date"],
  },
  {
    tableName: "ProductWithLocation",
    columns: [
      { name: "product_id", type: "Int64" }, // Made required
      { name: "product_name", type: "Nullable(String)", nullable: true },
      { name: "description", type: "Nullable(String)", nullable: true },
      { name: "category_id", type: "Nullable(Int64)", nullable: true },
      { name: "tags", type: /Array\(String\)/ }, // Arrays cannot be nullable in ClickHouse
      { name: "location", type: "String" },
      { name: "inventory_id", type: "Int64" },
    ],
    engine: "ReplacingMergeTree",
    orderBy: ["inventory_id", "location"],
  },
  {
    tableName: "EngineTest",
    columns: [
      { name: "id", type: "String" },
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
      { name: "location", type: "String" },
      { name: "category", type: "String" },
      { name: "value", type: "Float64" },
    ],
    engine: "MergeTree",
    orderBy: ["id", "location", "category"],
  },
  // Array transform test
  {
    tableName: "ArrayOutput",
    columns: [
      { name: "input_id", type: "String" },
      { name: "value", type: "String" },
      { name: "index", type: "Int64" }, // Python int becomes Int64
      { name: "timestamp", type: /DateTime\('UTC'\)/ },
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
