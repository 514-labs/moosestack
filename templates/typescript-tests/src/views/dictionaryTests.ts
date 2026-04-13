/**
 * OlapDictionary E2E test definitions.
 *
 * Defines a simple integer-keyed lookup dictionary over the existing
 * IndexTestTable to exercise the full dictionary lifecycle:
 * TypeScript definition → Rust parsing → migration DDL → ClickHouse.
 */
import { OlapDictionary, UInt64 } from "@514labs/moose-lib";
import { IndexTestTable } from "../ingest/models";

/**
 * Attribute shape for the IndexTest dictionary lookup.
 * All columns from IndexTest are available as dictionary attributes.
 */
interface IndexTestLookup {
  u64: UInt64; // primary key — UInt64 integer key for HASHED layout
  i32: number; // attribute
  s: string; // attribute
}

/**
 * A HASHED dictionary over IndexTestTable.
 * UInt64 primary key → HASHED layout (fastest for numeric keys).
 * lifetime: 3600 → reload from ClickHouse at most once per hour.
 */
export const indexTestLookupDict = new OlapDictionary<IndexTestLookup>(
  "dict_index_test_lookup",
  {
    sourceTable: IndexTestTable,
    primaryKey: ["u64"],
    layout: { type: "HASHED" },
    lifetime: 3600,
  },
);
