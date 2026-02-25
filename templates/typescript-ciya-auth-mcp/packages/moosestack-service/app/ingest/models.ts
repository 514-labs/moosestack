// Data model for MCP template demonstration
// DataEvent model with org_id for multi-tenant data isolation (Tier 3)

import { IngestPipeline, Key } from "@514labs/moose-lib";

export interface DataEvent {
  eventId: Key<string>; // Primary key for ClickHouse table
  timestamp: Date;
  eventType: string;
  data: string;
  org_id: string; // Tenant identifier for row-level security
}

export const DataEventPipeline = new IngestPipeline<DataEvent>("DataEvent", {
  table: true, // Create ClickHouse table
  stream: true, // Enable streaming
  ingestApi: true, // POST /ingest/DataEvent
});
