// Minimal data model for MCP template demonstration
// This DataEvent model provides a simple table for testing MCP queries

import { OlapTable, Stream, IngestApi } from "@514labs/moose-lib";

export interface DataEvent {
  eventId: string;
  timestamp: Date;
  eventType: string;
  data: string;
}

export const DataEventTable = new OlapTable<DataEvent>("DataEvent", {
  orderByFields: ["eventId", "timestamp"],
});

export const DataEventStream = new Stream<DataEvent>("DataEvent", {
  destination: DataEventTable,
});

export const DataEventIngestApi = new IngestApi<DataEvent>("DataEvent", {
  destination: DataEventStream,
});
