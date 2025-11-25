import typia from "typia";
import {
  IngestPipeline,
  Key,
  OlapTable,
  DeadLetterModel,
  DateTime,
  DateTime64,
  DateTimeString,
  DateTime64String,
  ClickHouseDefault,
  ClickHousePoint,
  ClickHouseRing,
  ClickHouseLineString,
  ClickHouseMultiLineString,
  ClickHousePolygon,
  ClickHouseMultiPolygon,
  ClickHouseEngines,
  SimpleAggregated,
  UInt64,
  ClickHouseByteSize,
  ClickHouseJson,
  Int64,
  Codec,
} from "@514labs/moose-lib";

/**
 * Data Pipeline: Raw Record (Foo) → Processed Record (Bar)
 * Raw (Foo) → HTTP → Raw Stream → Transform → Derived (Bar) → Processed Stream → DB Table
 */

/** =======Data Models========= */

/** Raw data ingested via API */
export interface Foo {
  primaryKey: Key<string>; // Unique ID
  timestamp: number; // Unix timestamp
  optionalText?: string; // Text to analyze
}

/** Analyzed text metrics derived from Foo */
export interface Bar {
  primaryKey: Key<string>; // From Foo.primaryKey
  utcTimestamp: DateTime; // From Foo.timestamp
  hasText: boolean; // From Foo.optionalText?
  textLength: number; // From Foo.optionalText.length
}

/** =======Pipeline Configuration========= */

export const deadLetterTable = new OlapTable<DeadLetterModel>("FooDeadLetter", {
  orderByFields: ["failedAt"],
});

/** Raw data ingestion */
export const FooPipeline = new IngestPipeline<Foo>("Foo", {
  table: false, // No table; only stream raw records
  stream: true, // Buffer ingested records
  ingestApi: true, // POST /ingest/Foo
  deadLetterQueue: {
    destination: deadLetterTable,
  },
});

/** Buffering and storing processed records (@see transforms.ts for transformation logic) */
export const BarPipeline = new IngestPipeline<Bar>("Bar", {
  table: true, // Persist in ClickHouse table "Bar"
  stream: true, // Buffer processed records
  ingestApi: false, // No API; only derive from processed Foo records
});

/** =======Comprehensive Type Testing Data Models========= */

/** Test 1: Basic primitive types */
export interface BasicTypes {
  id: Key<string>;
  timestamp: DateTime;
  stringField: string;
  numberField: number;
  booleanField: boolean;
  optionalString?: string;
  nullableNumber: number | null;
}

/** Test 2: Simple arrays of primitives */
export interface SimpleArrays {
  id: Key<string>;
  timestamp: DateTime;
  stringArray: string[];
  numberArray: number[];
  booleanArray: boolean[];
  optionalStringArray?: string[];
  mixedOptionalArray?: string[];
}

/** Test 3: Nested objects */
export interface NestedObjects {
  id: Key<string>;
  timestamp: DateTime;
  address: {
    street: string;
    city: string;
    coordinates: {
      lat: number;
      lng: number;
    };
  };
  metadata: {
    tags: string[];
    priority: number;
    config: {
      enabled: boolean;
      settings: {
        theme: string;
        notifications: boolean;
      };
    };
  };
}

/** Test 4: Arrays of objects */
export interface ArraysOfObjects {
  id: Key<string>;
  timestamp: DateTime;
  users: {
    name: string;
    age: number;
    active: boolean;
  }[];
  transactions: {
    id: string;
    amount: number;
    currency: string;
    metadata: {
      category: string;
      tags: string[];
    };
  }[];
}

/** Test 5: Deeply nested arrays (main focus for ENG-875) - ClickHouse compatible */
export interface DeeplyNestedArrays {
  id: Key<string>;
  timestamp: DateTime;
  // Level 1: Array of arrays (safe)
  matrix2D: number[][];
  // Level 2: Array of arrays of arrays (safe)
  matrix3D: number[][][];
  // Level 3: Array of arrays of arrays of arrays (pushing limits but should work)
  matrix4D: number[][][][];
  // Simplified nested: Reduce nesting depth to avoid ClickHouse issues
  complexNested: {
    category: string;
    items: {
      name: string;
      values: number[];
      data: string[];
      // Flattened structure instead of deeply nested objects
      metricNames: string[];
      metricValues: number[];
    }[];
  }[];
}

/** Test 6: Mixed complex types (ClickHouse-safe) */
export interface MixedComplexTypes {
  id: Key<string>;
  timestamp: DateTime;
  // Arrays with click events (safe)
  events: {
    type: string;
    target: string;
    coordinateX: number;
    coordinateY: number;
  }[];
  // Flattened optional structures (avoid nested optionals)
  nestedData: {
    required: string;
    optionalData: string[]; // Flattened, no nested optionals
    tags: string[];
    values: number[];
  }[];
  // Multi-dimensional with objects (safe)
  complexMatrix: {
    row: number;
    columns: {
      col: number;
      values: string[];
    }[];
  }[];
}

/** Test 7: Edge cases and boundary conditions (ClickHouse-compatible) */
export interface EdgeCases {
  id: Key<string>;
  timestamp: DateTime;
  // Empty arrays (safe)
  emptyStringArray: string[];
  emptyObjectArray: { id: string }[];
  // Simplified nullable structures (avoid nested nullables)
  nullableString?: string;
  nullableNumber?: number;
  // Moderate depth nesting (3 levels max for safety)
  moderateNesting: {
    level1: {
      level2: {
        data: string[];
        values: number[];
      }[];
    }[];
  };
  // Simplified complex arrays
  complexArray: {
    id: string;
    properties: {
      key: string;
      value: string;
      tags: string[];
    }[];
    metrics: {
      name: string;
      values: number[];
    }[];
  }[];
}

/** =======JSON Types Test========= */

interface JsonInner {
  name: string;
  count: Int64;
}

export interface JsonTest {
  id: Key<string>;
  timestamp: DateTime;
  // Test JSON with full configuration (max_dynamic_paths, max_dynamic_types, skip_paths, skip_regexes)
  payloadWithConfig: JsonInner &
    ClickHouseJson<256, 16, ["skip.me"], ["^tmp\\."]>;
  // Test JSON with paths but without configuration
  payloadBasic: JsonInner & ClickHouseJson;
}

export const JsonTestPipeline = new IngestPipeline<JsonTest>("JsonTest", {
  table: true,
  stream: true,
  ingestApi: true,
});

/** =======Pipeline Configurations for Test Models========= */

export const BasicTypesPipeline = new IngestPipeline<BasicTypes>("BasicTypes", {
  table: true,
  stream: true,
  ingestApi: true,
});

export const SimpleArraysPipeline = new IngestPipeline<SimpleArrays>(
  "SimpleArrays",
  {
    table: true,
    stream: true,
    ingestApi: true,
  },
);

export const NestedObjectsPipeline = new IngestPipeline<NestedObjects>(
  "NestedObjects",
  {
    table: true,
    stream: true,
    ingestApi: true,
  },
);

export const ArraysOfObjectsPipeline = new IngestPipeline<ArraysOfObjects>(
  "ArraysOfObjects",
  {
    table: true,
    stream: true,
    ingestApi: true,
  },
);

export const DeeplyNestedArraysPipeline =
  new IngestPipeline<DeeplyNestedArrays>("DeeplyNestedArrays", {
    table: true,
    stream: true,
    ingestApi: true,
  });

export const MixedComplexTypesPipeline = new IngestPipeline<MixedComplexTypes>(
  "MixedComplexTypes",
  {
    table: true,
    stream: true,
    ingestApi: true,
  },
);

export const EdgeCasesPipeline = new IngestPipeline<EdgeCases>("EdgeCases", {
  table: true,
  stream: true,
  ingestApi: true,
});

/** =======Optional Nested Fields with ClickHouse Defaults Test========= */

/** Test interface with optional nested fields and ClickHouse defaults */
export interface TestNested {
  name?: string;
  age?: number;
}

export interface OptionalNestedTest {
  id: Key<string>;
  timestamp: DateTime;
  nested: TestNested[];
  other: string & ClickHouseDefault<"''">;
}

export const OptionalNestedTestPipeline =
  new IngestPipeline<OptionalNestedTest>("OptionalNestedTest", {
    table: true,
    stream: true,
    ingestApi: true,
  });

/** =======Geometry Types========= */

export interface GeoTypes {
  id: Key<string>;
  timestamp: DateTime;
  point: ClickHousePoint;
  ring: ClickHouseRing;
  lineString: ClickHouseLineString;
  multiLineString: ClickHouseMultiLineString;
  polygon: ClickHousePolygon;
  multiPolygon: ClickHouseMultiPolygon;
}

export const GeoTypesPipeline = new IngestPipeline<GeoTypes>("GeoTypes", {
  table: true,
  stream: true,
  ingestApi: true,
});

/** =======Versioned OlapTables Test========= */
// Test versioned OlapTables - same name, different versions
// This demonstrates the OlapTable versioning functionality

/** Version 1.0 of user events - basic structure */
export interface UserEventV1 {
  userId: Key<string>;
  eventType: string;
  timestamp: number;
  metadata?: string;
}

/** Version 2.0 of user events - enhanced with session tracking */
export interface UserEventV2 {
  userId: Key<string>;
  eventType: string;
  timestamp: number;
  metadata?: string;
  sessionId: string;
  userAgent?: string;
}

// Version 1.0 - MergeTree engine
export const userEventsV1 = new OlapTable<UserEventV1>("UserEvents", {
  version: "1.0",
  engine: ClickHouseEngines.MergeTree,
  orderByFields: ["userId", "timestamp"],
});

// Version 2.0 - ReplacingMergeTree engine with enhanced schema
export const userEventsV2 = new OlapTable<UserEventV2>("UserEvents", {
  version: "2.0",
  engine: ClickHouseEngines.ReplacingMergeTree,
  orderByFields: ["userId", "sessionId", "timestamp"],
});

/** =======SimpleAggregateFunction Test========= */
// Test SimpleAggregateFunction support for aggregated metrics
// This demonstrates using SimpleAggregateFunction with AggregatingMergeTree

export interface SimpleAggTest {
  date_stamp: string & typia.tags.Format<"date"> & ClickHouseByteSize<2>;
  table_name: string;
  row_count: UInt64 & SimpleAggregated<"sum", UInt64>;
  max_value: number & SimpleAggregated<"max", number>;
  min_value: number & SimpleAggregated<"min", number>;
  last_updated: DateTime & SimpleAggregated<"anyLast", DateTime>;
}

export const SimpleAggTestTable = new OlapTable<SimpleAggTest>(
  "SimpleAggTest",
  {
    orderByFields: ["date_stamp", "table_name"],
    engine: ClickHouseEngines.AggregatingMergeTree,
  },
);

// =======Index Extraction Test Table=======
export interface IndexTest {
  u64: Key<UInt64>;
  i32: number;
  s: string;
}

export const IndexTestTable = new OlapTable<IndexTest>("IndexTest", {
  engine: ClickHouseEngines.MergeTree,
  orderByFields: ["u64"],
  indexes: [
    {
      name: "idx1",
      expression: "u64",
      type: "bloom_filter",
      arguments: [],
      granularity: 3,
    },
    {
      name: "idx2",
      expression: "u64 * i32",
      type: "minmax",
      arguments: [],
      granularity: 3,
    },
    {
      name: "idx3",
      expression: "u64 * length(s)",
      type: "set",
      arguments: ["1000"],
      granularity: 4,
    },
    {
      name: "idx4",
      expression: "(u64, i32)",
      type: "MinMax",
      arguments: [],
      granularity: 1,
    },
    {
      name: "idx5",
      expression: "(u64, i32)",
      type: "minmax",
      arguments: [],
      granularity: 1,
    },
    {
      name: "idx6",
      expression: "toString(i32)",
      type: "ngrambf_v1",
      arguments: ["2", "256", "1", "123"],
      granularity: 1,
    },
    {
      name: "idx7",
      expression: "s",
      type: "nGraMbf_v1",
      arguments: ["3", "256", "1", "123"],
      granularity: 1,
    },
  ],
});

/** =======Real-World Production Patterns (District Cannabis Inspired)========= */

/** Test 8: Complex discount structure with mixed nullability */
export interface DiscountInfo {
  discountId?: number;
  discountName?: string | null; // Explicit null union
  discountReason?: string | null;
  amount: number; // Required field
}

/** Test 9: Transaction item with complex nested structure */
export interface ProductItem {
  productId?: number;
  productName?: string | null;
  quantity: number;
  unitPrice: number;
  unitCost?: number | null;
  packageId?: string | null;
}

/** Test 10: Complex transaction with multiple array types and ReplacingMergeTree */
export interface ComplexTransaction {
  transactionId: Key<number>; // Primary key
  customerId?: number;
  transactionDate: DateTime;
  location: string; // Part of order by
  subtotal: number;
  tax: number;
  total: number;
  // Multiple complex array fields
  items: ProductItem[];
  discounts: DiscountInfo[];
  orderIds: number[]; // Simple array
  // Mixed nullability patterns
  tipAmount?: number | null;
  invoiceNumber?: string | null;
  terminalName?: string; // Optional without null
  // Boolean fields
  isVoid: boolean;
  isTaxInclusive?: boolean;
}

/** Test 11: Omit pattern with type extension (common pattern) */
interface BaseProduct {
  productId?: number;
  productName?: string | null;
  description?: string | null;
  categoryId?: number | null;
  tags: string[]; // Remove optional - arrays cannot be nullable in ClickHouse
}

export interface ProductWithLocation extends Omit<BaseProduct, "productId"> {
  productId: number; // Make required
  location: string;
  inventoryId: Key<number>;
}

/** Test 12: Engine and ordering configuration test */
export interface EngineTest {
  id: Key<string>;
  timestamp: DateTime;
  location: string;
  category: string;
  value: number;
}

/** =======Pipeline Configurations for Production Patterns========= */

export const ComplexTransactionPipeline =
  new IngestPipeline<ComplexTransaction>("ComplexTransaction", {
    table: {
      engine: ClickHouseEngines.ReplacingMergeTree,
      orderByFields: ["transactionId", "location", "transactionDate"], // Primary key must be first
    },
    stream: true,
    ingestApi: true,
  });

export const ProductWithLocationPipeline =
  new IngestPipeline<ProductWithLocation>("ProductWithLocation", {
    table: {
      engine: ClickHouseEngines.ReplacingMergeTree,
      orderByFields: ["inventoryId", "location"],
    },
    stream: true,
    ingestApi: true,
  });

export const EngineTestPipeline = new IngestPipeline<EngineTest>("EngineTest", {
  table: {
    engine: ClickHouseEngines.MergeTree,
    orderByFields: ["id", "location", "category"],
  },
  stream: true,
  ingestApi: true,
});

/** =======Array Transform Test Models========= */
// Test models for verifying that transforms returning arrays produce multiple Kafka messages

/** Input model for array transform test - contains an array to explode */
export interface ArrayInput {
  id: Key<string>;
  data: string[]; // Array of strings to explode into individual records
}

/** Output model for array transform test - one record per array item */
export interface ArrayOutput {
  inputId: Key<string>; // Reference to source ArrayInput.id
  value: string; // From array element
  index: number; // Position in original array
  timestamp: DateTime;
}

// Use OlapTable for output table
export const ArrayOutputTable = new OlapTable<ArrayOutput>("ArrayOutput", {
  orderByFields: ["inputId", "timestamp"],
});

// Create a Stream that writes to the OlapTable
import { Stream, IngestApi } from "@514labs/moose-lib";

export const arrayOutputStream = new Stream<ArrayOutput>("ArrayOutput", {
  destination: ArrayOutputTable,
});

export const arrayInputStream = new Stream<ArrayInput>("ArrayInput");

export const ingestapi = new IngestApi<ArrayInput>("array-input", {
  destination: arrayInputStream,
});

/** =======Large Message Test Models========= */
// Test models for verifying DLQ behavior with messages that exceed Kafka size limits

/** Input model for large message test */
export interface LargeMessageInput {
  id: Key<string>;
  timestamp: DateTime;
  multiplier: number; // Controls output size
}

/** Output model that will be very large */
export interface LargeMessageOutput {
  id: Key<string>;
  timestamp: DateTime;
  largeData: string; // Will contain ~1MB of data
}

// Dead letter table for large message failures
export const largeMessageDeadLetterTable = new OlapTable<DeadLetterModel>(
  "LargeMessageDeadLetter",
  {
    orderByFields: ["failedAt"],
  },
);

// Input pipeline with DLQ configured
export const LargeMessageInputPipeline = new IngestPipeline<LargeMessageInput>(
  "LargeMessageInput",
  {
    table: false,
    stream: true,
    ingestApi: true,
    deadLetterQueue: {
      destination: largeMessageDeadLetterTable,
    },
  },
);

// Output table
export const LargeMessageOutputTable = new OlapTable<LargeMessageOutput>(
  "LargeMessageOutput",
  {
    orderByFields: ["id", "timestamp"],
  },
);

// Output stream
export const largeMessageOutputStream = new Stream<LargeMessageOutput>(
  "LargeMessageOutput",
  {
    destination: LargeMessageOutputTable,
  },
);

/** =======DateTime Precision Test Models========= */
// Test models for verifying DateTime precision handling (microseconds)
// Tests ENG-1453: Ensure microsecond precision is preserved

/** Input model with datetime strings */
export interface DateTimePrecisionTestData {
  id: Key<string>;
  createdAt: DateTime;
  timestampMs: DateTime64<3>;
  timestampUsDate: DateTime64<6>;
  timestampUsString: DateTime64String<6>;
  timestampNs: DateTime64String<9>;
  createdAtString: DateTimeString;
}

// Input pipeline (no table, just stream)
export const DateTimePrecisionInputPipeline =
  new IngestPipeline<DateTimePrecisionTestData>("DateTimePrecisionInput", {
    table: false,
    stream: true,
    ingestApi: true,
  });

// Output table
export const DateTimePrecisionOutputTable =
  new OlapTable<DateTimePrecisionTestData>("DateTimePrecisionOutput", {
    orderByFields: ["id"],
  });

// Output stream
export const dateTimePrecisionOutputStream =
  new Stream<DateTimePrecisionTestData>("DateTimePrecisionOutput", {
    destination: DateTimePrecisionOutputTable,
  });

// =======Codec Compression Test=======
export interface CodecTest {
  id: Key<string>;
  timestamp: DateTime & Codec<"Delta, LZ4">;
  log_blob: Record<string, any> & Codec<"ZSTD(3)">;
  combination_hash: UInt64[] & Codec<"ZSTD(1)">;
  temperature: number & Codec<"Gorilla, ZSTD(3)">;
  request_count: number & Codec<"DoubleDelta, LZ4">;
  user_agent: string & Codec<"ZSTD(3)">;
  tags: string[] & Codec<"LZ4">;
  status_code: number;
}

export const CodecTestPipeline = new IngestPipeline<CodecTest>("CodecTest", {
  table: true,
  stream: true,
  ingestApi: true,
});
