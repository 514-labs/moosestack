import { createMooseCacheCheckpointStore } from "./checkpoint-store";
import {
  Checkpoint,
  CheckpointStore,
  DurablePipelineConfig,
  ResourceDefinitions,
  ReconnectPolicy,
  SourceAdapter,
  SourceEnvelope,
} from "./types";

export interface ConnectorPipelineOptions<
  TResource extends string,
  TPayload,
  TCheckpoint extends Checkpoint,
> {
  checkpointStore?: CheckpointStore<TCheckpoint>;
  resources?: ResourceDefinitions<TResource, TPayload, TCheckpoint>;
}

export interface ConnectorPipelineDefinition<
  TResource extends string,
  TPayload,
  TCheckpoint extends Checkpoint,
> {
  pipelineId: string;
  source: SourceAdapter<
    SourceEnvelope<TResource, TPayload, TCheckpoint>,
    TCheckpoint
  >;
  defaultResources: ResourceDefinitions<TResource, TPayload, TCheckpoint>;
  defaultCheckpointKeyPrefix: string;
  reconnectPolicy?: ReconnectPolicy;
  onError?: (error: unknown) => void;
}

export function createConnectorPipeline<
  TResource extends string,
  TPayload,
  TCheckpoint extends Checkpoint,
>(
  definition: ConnectorPipelineDefinition<TResource, TPayload, TCheckpoint>,
  options?: ConnectorPipelineOptions<TResource, TPayload, TCheckpoint>,
): DurablePipelineConfig<TResource, TPayload, TCheckpoint> {
  return {
    pipelineId: definition.pipelineId,
    source: definition.source,
    resources: options?.resources ?? definition.defaultResources,
    reconnectPolicy: definition.reconnectPolicy,
    onError: definition.onError,
    checkpointStore:
      options?.checkpointStore ??
      createMooseCacheCheckpointStore<TCheckpoint>({
        keyPrefix: definition.defaultCheckpointKeyPrefix,
      }),
  };
}
