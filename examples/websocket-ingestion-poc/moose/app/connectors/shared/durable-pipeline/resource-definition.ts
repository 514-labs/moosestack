import { Checkpoint, WebSocketResourceDefinition } from "./types";

export function defineWebSocketResource<
  TResource extends string,
  TRawMessage,
  TPayload,
  TCheckpoint extends Checkpoint,
>(
  definition: WebSocketResourceDefinition<
    TResource,
    TRawMessage,
    TPayload,
    TCheckpoint
  >,
): WebSocketResourceDefinition<TResource, TRawMessage, TPayload, TCheckpoint> {
  return definition;
}

export const defineResource = defineWebSocketResource;
