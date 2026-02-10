import { createMooseCacheCheckpointStore } from "./checkpoint-store";
import {
  Checkpoint,
  CheckpointStore,
  DurablePipelineConfig,
  ReconnectPolicy,
  WebSocketSourceAdapter,
} from "./types";

export interface ConnectorPipelineOptions<TCheckpoint extends Checkpoint> {
  checkpointStore?: CheckpointStore<TCheckpoint>;
}

export interface ConnectorPipelineDefinition<
  TResource extends string,
  TRawMessage,
  TPayload,
  TCheckpoint extends Checkpoint,
> {
  pipelineId: string;
  source: WebSocketSourceAdapter<TResource, TRawMessage, TPayload, TCheckpoint>;
  checkpointStoreKeyPrefix: string;
  reconnectPolicy?: ReconnectPolicy;
  onError?: (error: unknown) => void;
}

export function createConnectorPipeline<
  TResource extends string,
  TRawMessage,
  TPayload,
  TCheckpoint extends Checkpoint,
>(
  definition: ConnectorPipelineDefinition<
    TResource,
    TRawMessage,
    TPayload,
    TCheckpoint
  >,
  options?: ConnectorPipelineOptions<TCheckpoint>,
): DurablePipelineConfig<TResource, TRawMessage, TPayload, TCheckpoint> {
  return {
    pipelineId: definition.pipelineId,
    source: definition.source,
    reconnectPolicy: definition.reconnectPolicy,
    onError: definition.onError,
    checkpointStore:
      options?.checkpointStore ??
      createMooseCacheCheckpointStore<TCheckpoint>({
        keyPrefix: definition.checkpointStoreKeyPrefix,
      }),
  };
}
