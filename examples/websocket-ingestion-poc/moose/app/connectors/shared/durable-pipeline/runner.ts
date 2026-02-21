import { DEFAULT_RECONNECT_POLICY } from "./backoff";
import { runDurablePipelineLoop } from "./run-loop";
import { Checkpoint, DurablePipelineConfig, PipelineControl } from "./types";

export async function runDurablePipeline<
  TResource extends string,
  TRawMessage,
  TPayload,
  TCheckpoint extends Checkpoint = Checkpoint,
>(
  config: DurablePipelineConfig<TResource, TRawMessage, TPayload, TCheckpoint>,
): Promise<PipelineControl> {
  const reconnectPolicy = config.reconnectPolicy ?? DEFAULT_RECONNECT_POLICY;
  return runDurablePipelineLoop(config, reconnectPolicy);
}
