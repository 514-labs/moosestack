import {
  RealtimeChannel,
  SupabaseClient,
  createClient,
} from "@supabase/supabase-js";
import { defineWebSocketSource } from "../shared/durable-pipeline/source-definition";
import {
  SupabaseChangePayload,
  SupabaseCheckpoint,
  SupabaseResourceName,
} from "./types";
import { projectsResource } from "./resources/projects";
import { timeEntriesResource } from "./resources/time-entries";
import { normalizeSupabaseChangePayload } from "./resources/shared";

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
  emitRaw: (payload: SupabaseChangePayload) => Promise<void>,
  onDisconnect: (error?: unknown) => void,
): void {
  channel.on(
    "postgres_changes",
    { event: "*", schema, table: resource },
    async (payload: unknown) => {
      try {
        await emitRaw(normalizeSupabaseChangePayload(payload));
      } catch (error) {
        onDisconnect(error);
      }
    },
  );
}

export const supabaseSource = defineWebSocketSource<
  SupabaseResourceName,
  SupabaseChangePayload,
  SupabaseChangePayload,
  SupabaseCheckpoint
>({
  name: "supabase",
  resources: [projectsResource, timeEntriesResource],
  start: async ({
    resources,
    fromCheckpoint,
    emitRaw,
    onDisconnect,
    signal,
  }) => {
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

    for (const resource of resources) {
      registerTableSubscription(
        channel,
        supabaseSchema,
        resource,
        emitRaw,
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
