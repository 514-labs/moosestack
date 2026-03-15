import {
  SupabaseChangePayload,
  SupabaseChangeRecord,
  SupabaseCheckpoint,
  SupabaseOperation,
  SupabaseResourceName,
} from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isSupabaseOperation(value: string): value is SupabaseOperation {
  return value === "INSERT" || value === "UPDATE" || value === "DELETE";
}

export function normalizeSupabaseChangePayload(
  payload: unknown,
): SupabaseChangePayload {
  if (!isRecord(payload)) {
    throw new Error("Supabase payload must be an object.");
  }

  return {
    schema: typeof payload.schema === "string" ? payload.schema : "public",
    table: typeof payload.table === "string" ? payload.table : "",
    eventType:
      typeof payload.eventType === "string" ? payload.eventType : "UNKNOWN",
    commit_timestamp:
      typeof payload.commit_timestamp === "string" ?
        payload.commit_timestamp
      : undefined,
    new: payload.new,
    old: payload.old,
  };
}

export function parseResourcePayload(
  payload: SupabaseChangePayload,
  resource: SupabaseResourceName,
): SupabaseChangePayload | null {
  if (payload.table && payload.table !== resource) {
    return null;
  }

  return payload;
}

function parseCommitTimestamp(
  rawTimestamp: string | undefined,
  fallback: Date,
): Date {
  const timestamp = rawTimestamp ?? fallback.toISOString();
  const parsed = new Date(timestamp);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid Supabase commit timestamp: ${timestamp}`);
  }

  return parsed;
}

function pickChangedRow(
  payload: SupabaseChangePayload,
): Record<string, unknown> {
  const preferred = payload.eventType === "DELETE" ? payload.old : payload.new;
  const fallback = payload.eventType === "DELETE" ? payload.new : payload.old;
  const row = preferred ?? fallback;

  if (!isRecord(row)) {
    throw new Error(
      "Supabase event payload did not include a row object in payload.new/payload.old.",
    );
  }

  return row;
}

function extractRowId(row: Record<string, unknown>): string | null {
  const id = row.id;

  if (typeof id === "string") {
    return id;
  }

  if (typeof id === "number" || typeof id === "bigint") {
    return String(id);
  }

  return null;
}

export function toSupabaseChangeRecord(
  resource: SupabaseResourceName,
  payload: SupabaseChangePayload,
  receivedAt: Date,
): SupabaseChangeRecord {
  if (!isSupabaseOperation(payload.eventType)) {
    throw new Error(
      `Unsupported Supabase event operation '${payload.eventType}'. Expected INSERT/UPDATE/DELETE.`,
    );
  }

  const row = pickChangedRow(payload);
  const commitTimestamp = parseCommitTimestamp(
    payload.commit_timestamp,
    receivedAt,
  );

  return {
    source_table: resource,
    row_id: extractRowId(row),
    operation: payload.eventType,
    commit_timestamp: commitTimestamp,
    cdc_operation: payload.eventType,
    cdc_timestamp: commitTimestamp,
    is_deleted: payload.eventType === "DELETE",
    payload_json: JSON.stringify(row),
    received_at: receivedAt,
  };
}

export function checkpointFromPayload(
  resource: SupabaseResourceName,
  payload: SupabaseChangePayload,
): SupabaseCheckpoint {
  const row = pickChangedRow(payload);

  return {
    resource,
    commit_timestamp: payload.commit_timestamp ?? new Date().toISOString(),
    row_id: extractRowId(row),
  };
}
