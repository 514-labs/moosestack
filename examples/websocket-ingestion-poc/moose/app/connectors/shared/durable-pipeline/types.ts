import { OlapTable, Stream } from "@514labs/moose-lib";

export type Checkpoint = Record<string, unknown>;

export type TableDestination = Pick<
  OlapTable<any>,
  "assertValidRecord" | "insert"
>;
export type StreamDestination = Pick<Stream<any>, "send">;
export type SinkDestination = TableDestination | StreamDestination;

export interface SourceEnvelope<
  TResource extends string = string,
  TPayload = Record<string, unknown>,
  TCheckpoint extends Checkpoint = Checkpoint,
> {
  resource: TResource;
  payload: TPayload;
  checkpoint?: TCheckpoint | null;
}

export interface SourceHandle {
  stop: () => Promise<void>;
}

export interface SourceStartContext<
  TEnvelope,
  TCheckpoint extends Checkpoint = Checkpoint,
> {
  fromCheckpoint: TCheckpoint | null;
  onEvent: (event: TEnvelope) => Promise<void>;
  onDisconnect: (error?: unknown) => void;
  signal: AbortSignal;
}

export interface SourceAdapter<
  TEnvelope,
  TCheckpoint extends Checkpoint = Checkpoint,
> {
  start: (
    context: SourceStartContext<TEnvelope, TCheckpoint>,
  ) => Promise<SourceHandle>;
}

export type TransformedRecord = Record<string, unknown>;
export type TransformResult = TransformedRecord | TransformedRecord[] | null;

export interface ResourceDefinition<
  TResource extends string = string,
  TPayload = Record<string, unknown>,
  TCheckpoint extends Checkpoint = Checkpoint,
> {
  destination: SinkDestination;
  transform?: (
    payload: TPayload,
    envelope: SourceEnvelope<TResource, TPayload, TCheckpoint>,
  ) => TransformResult;
}

export type ResourceDefinitions<
  TResource extends string = string,
  TPayload = Record<string, unknown>,
  TCheckpoint extends Checkpoint = Checkpoint,
> = Record<TResource, ResourceDefinition<TResource, TPayload, TCheckpoint>>;

export interface CheckpointStore<TCheckpoint extends Checkpoint = Checkpoint> {
  load: (pipelineId: string) => Promise<TCheckpoint | null>;
  save: (pipelineId: string, checkpoint: TCheckpoint) => Promise<void>;
}

export interface ReconnectPolicy {
  initialMs: number;
  maxMs: number;
  multiplier: number;
  jitter: number;
}

export interface DurablePipelineConfig<
  TResource extends string = string,
  TPayload = Record<string, unknown>,
  TCheckpoint extends Checkpoint = Checkpoint,
> {
  pipelineId: string;
  source: SourceAdapter<
    SourceEnvelope<TResource, TPayload, TCheckpoint>,
    TCheckpoint
  >;
  checkpointStore: CheckpointStore<TCheckpoint>;
  resources: ResourceDefinitions<TResource, TPayload, TCheckpoint>;
  onError?: (error: unknown) => void;
  reconnectPolicy?: ReconnectPolicy;
}

export interface PipelineControl {
  stop: () => Promise<void>;
  done: Promise<void>;
}
