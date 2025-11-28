/**
 * Index Signature Tests for IngestApi
 *
 * Tests the ability to use TypeScript index signatures in IngestApi data models.
 * This enables accepting arbitrary payload fields that can be transformed later.
 *
 * Related issue: ENG-1617
 */
import {
  IngestApi,
  Stream,
  OlapTable,
  Key,
  DateTime,
} from "@514labs/moose-lib";

/**
 * Input type with index signature allowing arbitrary additional fields.
 * Known fields (timestamp, eventName, userId) will be validated by Rust.
 * Unknown fields are passed through to the streaming function.
 */
export type UserEventInput = {
  timestamp: DateTime;
  eventName: string;
  userId: Key<string>;
  // Optional known fields
  orgId?: string;
  projectId?: string;
  // Index signature allows any additional properties
  [key: string]: any;
};

/**
 * Output type for processed events.
 * Known fields are extracted, arbitrary fields go into a JSON column.
 */
export interface UserEventOutput {
  timestamp: DateTime;
  eventName: string;
  userId: Key<string>;
  orgId?: string;
  projectId?: string;
  // JSON column for extra properties (uses Record<string, any> which maps to Json)
  properties: Record<string, any>;
}

// Output table for processed events
export const userEventOutputTable = new OlapTable<UserEventOutput>(
  "UserEventOutput",
  {
    orderByFields: ["userId", "timestamp"],
  },
);

// Stream for processed events
export const userEventOutputStream = new Stream<UserEventOutput>(
  "UserEventOutput",
  {
    destination: userEventOutputTable,
  },
);

// Input stream for raw events (with index signature)
export const userEventInputStream = new Stream<UserEventInput>(
  "UserEventInput",
);

// IngestApi accepting arbitrary payload fields
export const userEventIngestApi = new IngestApi<UserEventInput>(
  "userEventIngestApi",
  {
    destination: userEventInputStream,
    version: "0.1",
  },
);
