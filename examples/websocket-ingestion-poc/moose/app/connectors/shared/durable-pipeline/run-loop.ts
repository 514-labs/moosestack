import { getBackoffMs, waitMs } from "./backoff";
import { createDisconnectSignal } from "./disconnect-signal";
import { createEventProcessor } from "./event-processor";
import {
  Checkpoint,
  DurablePipelineConfig,
  PipelineControl,
  ReconnectPolicy,
  SourceHandle,
} from "./types";

async function stopSourceHandle(
  handle: SourceHandle | null,
  onError?: (error: unknown) => void,
): Promise<void> {
  if (!handle) {
    return;
  }

  try {
    await handle.stop();
  } catch (error) {
    onError?.(error);
  }
}

export function runDurablePipelineLoop<
  TResource extends string,
  TRawMessage,
  TPayload,
  TCheckpoint extends Checkpoint,
>(
  config: DurablePipelineConfig<TResource, TRawMessage, TPayload, TCheckpoint>,
  reconnectPolicy: ReconnectPolicy,
): PipelineControl {
  let shouldStop = false;
  let reconnectAttempt = 0;
  let activeHandle: SourceHandle | null = null;
  let activeAbortController: AbortController | null = null;
  let activeDisconnect: ((error?: unknown) => void) | null = null;

  const loop = (async () => {
    let checkpoint = await config.checkpointStore.load(config.pipelineId);

    while (!shouldStop) {
      const disconnectSignal = createDisconnectSignal();
      activeDisconnect = disconnectSignal.resolve;

      const abortController = new AbortController();
      activeAbortController = abortController;

      const eventProcessor = createEventProcessor({
        pipelineId: config.pipelineId,
        initialCheckpoint: checkpoint,
        resources: config.source.resources,
        checkpointStore: config.checkpointStore,
        onProcessingError: (error) => {
          disconnectSignal.resolve(error);
        },
      });

      try {
        activeHandle = await config.source.start({
          resources: config.source.resources.map((resource) => resource.name),
          fromCheckpoint: checkpoint,
          signal: abortController.signal,
          onDisconnect: (error?: unknown) => {
            disconnectSignal.resolve(error);
          },
          emitRaw: eventProcessor.onRawMessage,
        });

        reconnectAttempt = 0;

        const disconnectError = await disconnectSignal.promise;

        try {
          await eventProcessor.drain();
        } catch (error) {
          config.onError?.(error);
        } finally {
          checkpoint = eventProcessor.getCheckpoint();
        }

        if (!shouldStop && disconnectError) {
          config.onError?.(disconnectError);
        }
      } catch (error) {
        if (!shouldStop) {
          config.onError?.(error);
        }
      } finally {
        await stopSourceHandle(activeHandle, config.onError);
        activeHandle = null;
        activeAbortController = null;
        activeDisconnect = null;
      }

      if (shouldStop) {
        break;
      }

      const waitDurationMs = getBackoffMs(reconnectPolicy, reconnectAttempt);
      reconnectAttempt += 1;
      await waitMs(waitDurationMs);
    }
  })();

  return {
    stop: async () => {
      shouldStop = true;
      activeAbortController?.abort();
      activeDisconnect?.();
      await loop;
    },
    done: loop,
  };
}
