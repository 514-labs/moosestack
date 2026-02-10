import {
  Checkpoint,
  SourceAdapter,
  SourceHandle,
  SourceStartContext,
} from "./types";

export interface SourceDefinition<
  TEvent,
  TCheckpoint extends Checkpoint = Checkpoint,
> {
  start: (
    context: SourceStartContext<TEvent, TCheckpoint>,
  ) => Promise<SourceHandle>;
}

export function defineSource<
  TEvent,
  TCheckpoint extends Checkpoint = Checkpoint,
>(
  definition: SourceDefinition<TEvent, TCheckpoint>,
): SourceAdapter<TEvent, TCheckpoint> {
  return {
    start: (context) => definition.start(context),
  };
}
