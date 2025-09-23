import {
  IngestPipeline,
  Key,
  OlapTable,
  DeadLetterModel,
  DateTime,
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

/** =======Factory Method Examples========= */

// Example: Create a MergeTree-backed table using the OlapTable factory
// This demonstrates the recommended factory API that the compiler plugin supports
export const BarFactory = OlapTable.withMergeTree<Bar>(
  "BarFactory",
  ["primaryKey", "utcTimestamp"],
  { version: "1.0.0" },
);

// Example: Create a ReplacingMergeTree-backed table using the factory
export const BarReplacingFactory = OlapTable.withReplacingMergeTree<Bar>(
  "BarReplacingFactory",
  ["primaryKey", "utcTimestamp"],
  { ver: "utcTimestamp" },
);

// Example: Create an S3Queue-backed table using the factory
export const BarS3Factory = OlapTable.withS3Queue<Omit<Bar, "primaryKey">>(
  "BarS3Factory",
  "s3://example-bucket/path/*.json",
  "JSONEachRow",
);
