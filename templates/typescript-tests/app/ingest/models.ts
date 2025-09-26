import {
  IngestPipeline,
  Key,
  OlapTable,
  DeadLetterModel,
  DateTime,
  ClickHouseDefault,
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
  ingest: true, // POST /ingest/Foo
  deadLetterQueue: {
    destination: deadLetterTable,
  },
});

/** Buffering and storing processed records (@see transforms.ts for transformation logic) */
export const BarPipeline = new IngestPipeline<Bar>("Bar", {
  table: true, // Persist in ClickHouse table "Bar"
  stream: true, // Buffer processed records
  ingest: false, // No API; only derive from processed Foo records
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

/** =======Pipeline Configurations for Test Models========= */

export const BasicTypesPipeline = new IngestPipeline<BasicTypes>("BasicTypes", {
  table: true,
  stream: true,
  ingest: true,
});

export const SimpleArraysPipeline = new IngestPipeline<SimpleArrays>(
  "SimpleArrays",
  {
    table: true,
    stream: true,
    ingest: true,
  },
);

export const NestedObjectsPipeline = new IngestPipeline<NestedObjects>(
  "NestedObjects",
  {
    table: true,
    stream: true,
    ingest: true,
  },
);

export const ArraysOfObjectsPipeline = new IngestPipeline<ArraysOfObjects>(
  "ArraysOfObjects",
  {
    table: true,
    stream: true,
    ingest: true,
  },
);

export const DeeplyNestedArraysPipeline =
  new IngestPipeline<DeeplyNestedArrays>("DeeplyNestedArrays", {
    table: true,
    stream: true,
    ingest: true,
  });

export const MixedComplexTypesPipeline = new IngestPipeline<MixedComplexTypes>(
  "MixedComplexTypes",
  {
    table: true,
    stream: true,
    ingest: true,
  },
);

export const EdgeCasesPipeline = new IngestPipeline<EdgeCases>("EdgeCases", {
  table: true,
  stream: true,
  ingest: true,
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
  other?: string & ClickHouseDefault<"''">;
}

export const OptionalNestedTestPipeline =
  new IngestPipeline<OptionalNestedTest>("OptionalNestedTest", {
    table: true,
    stream: true,
    ingest: true,
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
      engine: "ReplacingMergeTree",
      orderByFields: ["location", "transactionId", "transactionDate"],
    },
    stream: true,
    ingest: true,
  });

export const ProductWithLocationPipeline =
  new IngestPipeline<ProductWithLocation>("ProductWithLocation", {
    table: {
      engine: "ReplacingMergeTree",
      orderByFields: ["inventoryId", "location"],
    },
    stream: true,
    ingest: true,
  });

export const EngineTestPipeline = new IngestPipeline<EngineTest>("EngineTest", {
  table: {
    engine: "MergeTree",
    orderByFields: ["id", "location", "category"],
  },
  stream: true,
  ingest: true,
});
