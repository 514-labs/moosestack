import {
  IngestPipeline,
  Key,
  OlapTable,
  DeadLetterModel,
  DateTime,
  DateTime64,
  UInt8,
  Int16,
  Float32,
  LowCardinality,
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
  updatedAt: DateTime64<3>; // Millisecond precision
  hasText: boolean; // From Foo.optionalText?
  textLength: number; // From Foo.optionalText.length
  metricU8: UInt8; // Example unsigned tinyint
  metricI16: Int16; // Example signed smallint
  ratioF32: Float32; // Example float32
  lcStatus: string & LowCardinality; // LowCardinality string
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
