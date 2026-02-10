import {
  RealtimeChannel,
  SupabaseClient,
  createClient,
} from "@supabase/supabase-js";
import { defineSource } from "../shared/durable-pipeline/source-definition";
import { getMappedSupabaseTables } from "./sinks";
import {
  SupabaseChangePayload,
  SupabaseChangeRecord,
  SupabaseCheckpoint,
  SupabaseOperation,
  SupabaseResourceName,
  SupabaseSourceEnvelope,
} from "./types";

const SUBSCRIPTION_ERROR_STATUSES = new Set(["CHANNEL_ERROR", "TIMED_OUT"]);

type ListenerStatus =
  | "SUBSCRIBED"
  | "CHANNEL_ERROR"
  | "TIMED_OUT"
  | "CLOSED"
  | string;

interface SupabaseConnectorEnv {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  supabaseSchema: string;
}

function isSupabaseOperation(value: string): value is SupabaseOperation {
  return value === "INSERT" || value === "UPDATE" || value === "DELETE";
}

function parseCommitTimestamp(rawTimestamp?: string): Date {
  const timestamp = rawTimestamp ?? new Date().toISOString();
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

  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new Error(
      "Supabase event payload did not include a row object in payload.new/payload.old.",
    );
  }

  return row as Record<string, unknown>;
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

function toSupabaseChangeRecord(
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
  const commitTimestamp = parseCommitTimestamp(payload.commit_timestamp);

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

function checkpointFromPayload(
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

function normalizePayload(payload: unknown): SupabaseChangePayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Supabase payload must be an object.");
  }

  const candidate = payload as Record<string, unknown>;

  return {
    schema: typeof candidate.schema === "string" ? candidate.schema : "public",
    table: typeof candidate.table === "string" ? candidate.table : "",
    eventType:
      typeof candidate.eventType === "string" ? candidate.eventType : "UNKNOWN",
    commit_timestamp:
      typeof candidate.commit_timestamp === "string" ?
        candidate.commit_timestamp
      : undefined,
    new: candidate.new,
    old: candidate.old,
  };
}

function getSupabaseConnectorEnv(): SupabaseConnectorEnv {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      [
        "Missing required Supabase connector environment variables.",
        "Expected:",
        "  SUPABASE_URL",
        "  SUPABASE_SERVICE_ROLE_KEY",
        "Then run:",
        "  moose workflow run supabase-cdc-listener",
      ].join("\n"),
    );
  }

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    supabaseSchema: process.env.SUPABASE_SCHEMA ?? "public",
  };
}

async function waitForSubscription(
  channel: RealtimeChannel,
  onDisconnect: (error?: unknown) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let didSubscribe = false;

    channel.subscribe((status: ListenerStatus, error?: Error) => {
      if (status === "SUBSCRIBED") {
        didSubscribe = true;
        resolve();
        return;
      }

      if (status === "CLOSED" && didSubscribe) {
        onDisconnect(new Error("Supabase realtime channel closed."));
        return;
      }

      if (SUBSCRIPTION_ERROR_STATUSES.has(status)) {
        const message = [
          `Supabase subscription failed with status '${status}'.`,
          error?.message,
        ]
          .filter(Boolean)
          .join("\n");

        const subscriptionError = new Error(message);
        if (!didSubscribe) {
          reject(subscriptionError);
          return;
        }

        onDisconnect(subscriptionError);
      }
    });
  });
}

function registerTableSubscription(
  channel: RealtimeChannel,
  schema: string,
  resource: SupabaseResourceName,
  onEvent: (event: SupabaseSourceEnvelope) => Promise<void>,
  onDisconnect: (error?: unknown) => void,
): void {
  channel.on(
    "postgres_changes",
    { event: "*", schema, table: resource },
    async (payload: unknown) => {
      try {
        const normalizedPayload = normalizePayload(payload);
        const receivedAt = new Date();

        await onEvent({
          resource,
          payload: toSupabaseChangeRecord(
            resource,
            normalizedPayload,
            receivedAt,
          ),
          checkpoint: checkpointFromPayload(resource, normalizedPayload),
        });
      } catch (error) {
        onDisconnect(error);
      }
    },
  );
}

export const supabaseSource = defineSource<
  SupabaseSourceEnvelope,
  SupabaseCheckpoint
>({
  start: async ({ fromCheckpoint, onEvent, onDisconnect, signal }) => {
    const { supabaseSchema, supabaseServiceRoleKey, supabaseUrl } =
      getSupabaseConnectorEnv();

    if (fromCheckpoint) {
      console.log(
        `Resuming Supabase source from checkpoint: ${JSON.stringify(fromCheckpoint)}`,
      );
    }

    const supabase: SupabaseClient = createClient(
      supabaseUrl,
      supabaseServiceRoleKey,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    const channel = supabase.channel(`supabase-source-${Date.now()}`);

    for (const table of getMappedSupabaseTables()) {
      registerTableSubscription(
        channel,
        supabaseSchema,
        table,
        onEvent,
        onDisconnect,
      );
    }

    await waitForSubscription(channel, onDisconnect);

    signal.addEventListener(
      "abort",
      () => {
        onDisconnect();
      },
      { once: true },
    );

    return {
      stop: async () => {
        await channel.unsubscribe();
        await supabase.removeChannel(channel);
      },
    };
  },
});
