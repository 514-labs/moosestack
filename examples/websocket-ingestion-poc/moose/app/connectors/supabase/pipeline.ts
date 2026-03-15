import { ConnectorPipelineOptions } from "../shared/durable-pipeline/connector-pipeline";
import { defineWebSocketConnector } from "../shared/durable-pipeline/connector-definition";
import { supabaseSource } from "./source";
import {
  SupabaseChangePayload,
  SupabaseCheckpoint,
  SupabaseResourceName,
} from "./types";

const PIPELINE_ID = "supabase-cdc-listener";

export type SupabasePipelineOptions =
  ConnectorPipelineOptions<SupabaseCheckpoint>;

export const supabaseConnector = defineWebSocketConnector<
  SupabaseResourceName,
  SupabaseChangePayload,
  SupabaseChangePayload,
  SupabaseCheckpoint
>({
  pipelineId: PIPELINE_ID,
  workflowName: "supabase-cdc-listener",
  taskName: "run-supabase-cdc-listener",
  source: supabaseSource,
  checkpointStoreKeyPrefix: "supabase-cdc-checkpoint",
  reconnectPolicy: {
    initialMs: 1_000,
    maxMs: 30_000,
    multiplier: 2,
    jitter: 0.2,
  },
  onError: (error) => {
    console.error("Supabase pipeline error", error);
  },
});

export const createSupabasePipeline = supabaseConnector.createPipeline;
export const startSupabasePipeline = supabaseConnector.startPipeline;
