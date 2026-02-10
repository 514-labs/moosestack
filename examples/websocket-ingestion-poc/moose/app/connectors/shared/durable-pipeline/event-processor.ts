import {
  Checkpoint,
  CheckpointStore,
  ResourceDefinition,
  ResourceDefinitions,
  SourceEnvelope,
  TransformResult,
  TransformedRecord,
} from "./types";
import { writeRecordsToDestination } from "./sink-writer";

interface EventProcessorOptions<
  TResource extends string,
  TPayload,
  TCheckpoint extends Checkpoint,
> {
  pipelineId: string;
  initialCheckpoint: TCheckpoint | null;
  resources: ResourceDefinitions<TResource, TPayload, TCheckpoint>;
  checkpointStore: CheckpointStore<TCheckpoint>;
  onProcessingError: (error: unknown) => void;
}

export interface EventProcessor<
  TResource extends string,
  TPayload,
  TCheckpoint extends Checkpoint,
> {
  onEvent: (
    envelope: SourceEnvelope<TResource, TPayload, TCheckpoint>,
  ) => Promise<void>;
  drain: () => Promise<void>;
  getCheckpoint: () => TCheckpoint | null;
}

function isPlainRecord(value: unknown): value is TransformedRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeTransformResult(
  resource: string,
  result: TransformResult,
): TransformedRecord[] {
  if (result == null) {
    return [];
  }

  if (Array.isArray(result)) {
    if (!result.every(isPlainRecord)) {
      throw new Error(
        `Resource '${resource}' transform must return plain object records.`,
      );
    }

    return result;
  }

  if (isPlainRecord(result)) {
    return [result];
  }

  throw new Error(
    `Resource '${resource}' transform must return a record, record array, or null.`,
  );
}

function defaultTransform(
  resource: string,
  payload: unknown,
): TransformedRecord[] {
  if (isPlainRecord(payload)) {
    return [payload];
  }

  if (Array.isArray(payload) && payload.every(isPlainRecord)) {
    return payload;
  }

  throw new Error(
    [
      `Resource '${resource}' payload is not a plain object record.`,
      "Provide resource.transform(...) when payload is not directly writable.",
    ].join("\n"),
  );
}

function getResourceOrThrow<
  TResource extends string,
  TPayload,
  TCheckpoint extends Checkpoint,
>(
  resources: ResourceDefinitions<TResource, TPayload, TCheckpoint>,
  resource: TResource,
): ResourceDefinition<TResource, TPayload, TCheckpoint> {
  const definition = resources[resource];
  if (!definition) {
    throw new Error(
      `No resource mapping for '${String(resource)}'. Add it in the connector resources map.`,
    );
  }

  return definition;
}

export function createEventProcessor<
  TResource extends string,
  TPayload,
  TCheckpoint extends Checkpoint,
>(
  options: EventProcessorOptions<TResource, TPayload, TCheckpoint>,
): EventProcessor<TResource, TPayload, TCheckpoint> {
  let checkpoint = options.initialCheckpoint;
  let processingChain: Promise<void> = Promise.resolve();

  const onEvent = async (
    envelope: SourceEnvelope<TResource, TPayload, TCheckpoint>,
  ): Promise<void> => {
    processingChain = processingChain.then(async () => {
      const resource = getResourceOrThrow(options.resources, envelope.resource);
      const transformed =
        resource.transform ?
          normalizeTransformResult(
            String(envelope.resource),
            resource.transform(envelope.payload, envelope),
          )
        : defaultTransform(String(envelope.resource), envelope.payload);

      if (transformed.length === 0) {
        return;
      }

      await writeRecordsToDestination(
        String(envelope.resource),
        resource.destination,
        transformed,
      );

      if (envelope.checkpoint != null) {
        await options.checkpointStore.save(
          options.pipelineId,
          envelope.checkpoint,
        );
        checkpoint = envelope.checkpoint;
      }
    });

    try {
      await processingChain;
    } catch (error) {
      options.onProcessingError(error);
    }
  };

  return {
    onEvent,
    drain: async () => {
      await processingChain;
    },
    getCheckpoint: () => checkpoint,
  };
}
