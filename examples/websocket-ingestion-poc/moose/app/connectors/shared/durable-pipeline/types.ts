import { OlapTable, Stream } from "@514labs/moose-lib";

export type Checkpoint = Record<string, unknown>;

export type TableSink = Pick<OlapTable<any>, "assertValidRecord" | "insert">;
export type StreamSink = Pick<Stream<any>, "send">;
export type SinkDestination = TableSink | StreamSink;

export interface ResourceProcessContext<TPayload = Record<string, unknown>> {
  payload: TPayload;
  receivedAt: Date;
}

export type TransformedRecord = Record<string, unknown>;

export interface ResourceProcessResult<
  TCheckpoint extends Checkpoint = Checkpoint,
> {
  records: TransformedRecord[];
  checkpoint?: TCheckpoint | null;
}

export type ResourceParseResult<TPayload> =
  | TPayload
  | TPayload[]
  | null
  | undefined;

export interface WebSocketResourceDefinition<
  TResource extends string = string,
  TRawMessage = unknown,
  TPayload = Record<string, unknown>,
  TCheckpoint extends Checkpoint = Checkpoint,
> {
  name: TResource;
  sink: SinkDestination;
  parse: (rawMessage: TRawMessage) => ResourceParseResult<TPayload>;
  process: (
    context: ResourceProcessContext<TPayload>,
  ) => ResourceProcessResult<TCheckpoint> | null;
}

export interface SourceHandle {
  stop: () => Promise<void>;
}

export interface WebSocketSourceStartContext<
  TResource extends string,
  TRawMessage,
  TCheckpoint extends Checkpoint,
> {
  resources: readonly TResource[];
  fromCheckpoint: TCheckpoint | null;
  emitRaw: (rawMessage: TRawMessage) => Promise<void>;
  onDisconnect: (error?: unknown) => void;
  signal: AbortSignal;
}

export interface WebSocketSourceAdapter<
  TResource extends string,
  TRawMessage,
  TPayload,
  TCheckpoint extends Checkpoint,
> {
  name: string;
  resources: readonly WebSocketResourceDefinition<
    TResource,
    TRawMessage,
    TPayload,
    TCheckpoint
  >[];
  start: (
    context: WebSocketSourceStartContext<TResource, TRawMessage, TCheckpoint>,
  ) => Promise<SourceHandle>;
}

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
  TResource extends string,
  TRawMessage,
  TPayload,
  TCheckpoint extends Checkpoint,
> {
  pipelineId: string;
  source: WebSocketSourceAdapter<TResource, TRawMessage, TPayload, TCheckpoint>;
  checkpointStore: CheckpointStore<TCheckpoint>;
  onError?: (error: unknown) => void;
  reconnectPolicy?: ReconnectPolicy;
}

export interface PipelineControl {
  stop: () => Promise<void>;
  done: Promise<void>;
}
