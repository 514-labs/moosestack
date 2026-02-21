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
  ReconnectPolicy,
  WebSocketSourceAdapter,
} from "./types";

export interface DefineWebSocketConnectorConfig<
  TResource extends string,
  TRawMessage,
  TPayload,
  TCheckpoint extends Checkpoint,
> {
  pipelineId: string;
  workflowName: string;
  taskName: string;
  source: WebSocketSourceAdapter<TResource, TRawMessage, TPayload, TCheckpoint>;
  checkpointStoreKeyPrefix: string;
  reconnectPolicy?: ReconnectPolicy;
  onError?: (error: unknown) => void;
}

export interface DefinedWebSocketConnector<
  TResource extends string,
  TRawMessage,
  TPayload,
  TCheckpoint extends Checkpoint,
> {
  createPipeline: (
    options?: ConnectorPipelineOptions<TCheckpoint>,
  ) => DurablePipelineConfig<TResource, TRawMessage, TPayload, TCheckpoint>;
  startPipeline: (
    options?: ConnectorPipelineOptions<TCheckpoint>,
  ) => Promise<PipelineControl>;
  workflow: ReturnType<typeof createLongRunningPipelineWorkflow>;
}

export function defineWebSocketConnector<
  TResource extends string,
  TRawMessage,
  TPayload,
  TCheckpoint extends Checkpoint,
>(
  config: DefineWebSocketConnectorConfig<
    TResource,
    TRawMessage,
    TPayload,
    TCheckpoint
  >,
): DefinedWebSocketConnector<TResource, TRawMessage, TPayload, TCheckpoint> {
  const createPipeline = (
    options?: ConnectorPipelineOptions<TCheckpoint>,
  ): DurablePipelineConfig<TResource, TRawMessage, TPayload, TCheckpoint> =>
    createConnectorPipeline(
      {
        pipelineId: config.pipelineId,
        source: config.source,
        checkpointStoreKeyPrefix: config.checkpointStoreKeyPrefix,
        reconnectPolicy: config.reconnectPolicy,
        onError: config.onError,
      },
      options,
    );

  const startPipeline = async (
    options?: ConnectorPipelineOptions<TCheckpoint>,
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

export const defineConnector = defineWebSocketConnector;
