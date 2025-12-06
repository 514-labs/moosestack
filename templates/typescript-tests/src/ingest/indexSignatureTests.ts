/**
 * Index Signature Tests for IngestApi and Stream
 *
 * Tests the ability to use TypeScript index signatures in IngestApi and Stream data models.
 * This enables accepting arbitrary payload fields that are passed to streaming functions.
 *
 * Related issue: ENG-1617
 *
 * KEY CONCEPTS:
 * - IngestApi and Stream: CAN have index signatures (accept variable fields)
 * - OlapTable: CANNOT have index signatures (ClickHouse requires fixed schema)
 * - Transform functions: Receive ALL fields (including extras from index signature)
 *   and must output to a fixed schema for OlapTable storage
 *
 * DATA FLOW:
 *   IngestApi (variable) → Stream (variable) → Transform → Stream (fixed) → OlapTable (fixed)
 */
import {
  IngestApi,
  Stream,
  OlapTable,
  Key,
  DateTime,
} from "@514labs/moose-lib";

// ============================================================================
// INPUT TYPES (with index signature - accept variable fields)
// ============================================================================

/**
 * Input type with index signature allowing arbitrary additional fields.
 * Known fields (timestamp, eventName, userId) are validated.
 * Unknown fields are passed through to streaming functions.
 */
export type UserEventInput = {
  timestamp: DateTime;
  eventName: string;
  userId: Key<string>;
  // Optional known fields
  orgId?: string;
  projectId?: string;
  // Index signature: allows any additional properties to be accepted
  [key: string]: any;
};

// Input stream for raw events (with index signature - accepts variable fields)
export const userEventInputStream = new Stream<UserEventInput>(
  "UserEventInput",
);

// IngestApi accepting arbitrary payload fields via index signature
export const userEventIngestApi = new IngestApi<UserEventInput>(
  "userEventIngestApi",
  {
    destination: userEventInputStream,
    version: "0.1",
  },
);

// ============================================================================
// OUTPUT TYPES (fixed schema - required for OlapTable)
// ============================================================================

/**
 * Output type with a FIXED schema for OlapTable storage.
 * Extra fields from the input are stored in a JSON column.
 *
 * Note: OlapTable requires fixed columns - ClickHouse needs to know the schema.
 * Use a JSON column (Record<string, any>) to store dynamic/extra fields.
 */
export interface UserEventOutput {
  timestamp: DateTime;
  eventName: string;
  userId: Key<string>;
  orgId?: string;
  projectId?: string;
  // JSON column for extra properties from index signature
  // This is how you persist variable fields to ClickHouse
  properties: Record<string, any>;
}

// Output table with fixed schema (JSON column stores variable data)
export const userEventOutputTable = new OlapTable<UserEventOutput>(
  "UserEventOutput",
  {
    orderByFields: ["userId", "timestamp"],
  },
);

// Stream for processed events (fixed schema)
export const userEventOutputStream = new Stream<UserEventOutput>(
  "UserEventOutput",
  {
    destination: userEventOutputTable,
  },
);
