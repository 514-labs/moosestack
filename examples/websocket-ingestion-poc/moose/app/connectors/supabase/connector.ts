import { ConnectorPipelineOptions } from "../shared/durable-pipeline/connector-pipeline";
import { defineConnector } from "../shared/durable-pipeline/connector-definition";
import { SUPABASE_RESOURCES } from "./sinks";
import { supabaseSource } from "./source";
import {
  SupabaseChangeRecord,
  SupabaseCheckpoint,
  SupabaseResourceName,
} from "./types";

const PIPELINE_ID = "supabase-cdc-listener";

export type SupabasePipelineOptions = ConnectorPipelineOptions<
  SupabaseResourceName,
  SupabaseChangeRecord,
  SupabaseCheckpoint
>;

const supabaseConnector = defineConnector<
  SupabaseResourceName,
  SupabaseChangeRecord,
  SupabaseCheckpoint
>({
  pipelineId: PIPELINE_ID,
  workflowName: "supabase-cdc-listener",
  taskName: "run-supabase-cdc-listener",
  source: supabaseSource,
  defaultResources: SUPABASE_RESOURCES,
  defaultCheckpointKeyPrefix: "supabase-cdc-checkpoint",
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
export const supabaseCdcListenerWorkflow = supabaseConnector.workflow;
