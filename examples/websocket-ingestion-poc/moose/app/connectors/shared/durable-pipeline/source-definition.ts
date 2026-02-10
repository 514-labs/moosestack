import {
  Checkpoint,
  WebSocketSourceAdapter,
  WebSocketSourceStartContext,
} from "./types";

export interface WebSocketSourceDefinition<
  TResource extends string,
  TRawMessage,
  TPayload,
  TCheckpoint extends Checkpoint,
> {
  name: string;
  resources: WebSocketSourceAdapter<
    TResource,
    TRawMessage,
    TPayload,
    TCheckpoint
  >["resources"];
  start: (
    context: WebSocketSourceStartContext<TResource, TRawMessage, TCheckpoint>,
  ) => ReturnType<
    WebSocketSourceAdapter<
      TResource,
      TRawMessage,
      TPayload,
      TCheckpoint
    >["start"]
  >;
}

export function defineWebSocketSource<
  TResource extends string,
  TRawMessage,
  TPayload,
  TCheckpoint extends Checkpoint,
>(
  definition: WebSocketSourceDefinition<
    TResource,
    TRawMessage,
    TPayload,
    TCheckpoint
  >,
): WebSocketSourceAdapter<TResource, TRawMessage, TPayload, TCheckpoint> {
  return {
    name: definition.name,
    resources: definition.resources,
    start: (context) => definition.start(context),
  };
}

export const defineSource = defineWebSocketSource;
