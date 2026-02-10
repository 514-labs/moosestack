import { DateTime } from "@514labs/moose-lib";
import { SourceEnvelope } from "../shared/durable-pipeline/types";

export type SupabaseResourceName = "projects" | "time_entries";

export type SupabaseOperation = "INSERT" | "UPDATE" | "DELETE";

export interface SupabaseChangePayload {
  schema: string;
  table: string;
  eventType: string;
  commit_timestamp?: string;
  new: unknown;
  old: unknown;
}

export interface SupabaseCheckpoint extends Record<string, unknown> {
  resource: SupabaseResourceName;
  commit_timestamp: string;
  row_id: string | null;
}

export interface SupabaseChangeRecord extends Record<string, unknown> {
  source_table: string;
  row_id: string | null;
  operation: SupabaseOperation;
  commit_timestamp: DateTime;
  cdc_operation: SupabaseOperation;
  cdc_timestamp: DateTime;
  is_deleted: boolean;
  payload_json: string;
  received_at: DateTime;
}

export type SupabaseSourceEnvelope = SourceEnvelope<
  SupabaseResourceName,
  SupabaseChangeRecord,
  SupabaseCheckpoint
>;
