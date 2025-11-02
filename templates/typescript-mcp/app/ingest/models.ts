// Minimal data model for MCP template demonstration
// This DataEvent model provides a simple table for testing MCP queries

import { IngestPipeline, Key } from "@514labs/moose-lib";

export interface DataEvent {
  eventId: Key<string>; // Primary key for ClickHouse table
  timestamp: Date;
  eventType: string;
  data: string;
}

export const DataEventPipeline = new IngestPipeline<DataEvent>("DataEvent", {
  table: true, // Create ClickHouse table
  stream: true, // Enable streaming
  ingestApi: true, // POST /ingest/DataEvent
});
