import {
  ConnectorPipelineOptions,
  createConnectorPipeline,
} from "./connector-pipeline";
import { createLongRunningPipelineWorkflow } from "./pipeline-workflow";
import { runDurablePipeline } from "./runner";
import {
  Checkpoint,
  DurablePipelineConfig,
  PipelineControl,
  ResourceDefinitions,
  ReconnectPolicy,
  SourceEnvelope,
  SourceAdapter,
} from "./types";

export interface DefineConnectorConfig<
  TResource extends string,
  TPayload,
  TCheckpoint extends Checkpoint,
> {
  pipelineId: string;
  workflowName: string;
  taskName: string;
  source: SourceAdapter<
    SourceEnvelope<TResource, TPayload, TCheckpoint>,
    TCheckpoint
  >;
  defaultResources: ResourceDefinitions<TResource, TPayload, TCheckpoint>;
  defaultCheckpointKeyPrefix: string;
  reconnectPolicy?: ReconnectPolicy;
  onError?: (error: unknown) => void;
}

export interface DefinedConnector<
  TResource extends string,
  TPayload,
  TCheckpoint extends Checkpoint,
> {
  createPipeline: (
    options?: ConnectorPipelineOptions<TResource, TPayload, TCheckpoint>,
  ) => DurablePipelineConfig<TResource, TPayload, TCheckpoint>;
  startPipeline: (
    options?: ConnectorPipelineOptions<TResource, TPayload, TCheckpoint>,
  ) => Promise<PipelineControl>;
  workflow: ReturnType<typeof createLongRunningPipelineWorkflow>;
}

export function defineConnector<
  TResource extends string,
  TPayload,
  TCheckpoint extends Checkpoint,
>(
  config: DefineConnectorConfig<TResource, TPayload, TCheckpoint>,
): DefinedConnector<TResource, TPayload, TCheckpoint> {
  const createPipeline = (
    options?: ConnectorPipelineOptions<TResource, TPayload, TCheckpoint>,
  ): DurablePipelineConfig<TResource, TPayload, TCheckpoint> =>
    createConnectorPipeline(
      {
        pipelineId: config.pipelineId,
        source: config.source,
        defaultResources: config.defaultResources,
        defaultCheckpointKeyPrefix: config.defaultCheckpointKeyPrefix,
        reconnectPolicy: config.reconnectPolicy,
        onError: config.onError,
      },
      options,
    );

  const startPipeline = async (
    options?: ConnectorPipelineOptions<TResource, TPayload, TCheckpoint>,
  ): Promise<PipelineControl> => runDurablePipeline(createPipeline(options));

  const workflow = createLongRunningPipelineWorkflow({
    workflowName: config.workflowName,
    taskName: config.taskName,
    startPipeline: () => startPipeline(),
  });

  return {
    createPipeline,
    startPipeline,
    workflow,
  };
}
