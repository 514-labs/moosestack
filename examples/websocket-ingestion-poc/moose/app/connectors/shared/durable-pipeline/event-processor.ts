import {
  Checkpoint,
  CheckpointStore,
  ResourceProcessResult,
  TransformedRecord,
  WebSocketResourceDefinition,
} from "./types";
import { writeRecordsToDestination } from "./sink-writer";

interface EventProcessorOptions<
  TResource extends string,
  TRawMessage,
  TPayload,
  TCheckpoint extends Checkpoint,
> {
  pipelineId: string;
  initialCheckpoint: TCheckpoint | null;
  resources: readonly WebSocketResourceDefinition<
    TResource,
    TRawMessage,
    TPayload,
    TCheckpoint
  >[];
  checkpointStore: CheckpointStore<TCheckpoint>;
  onProcessingError: (error: unknown) => void;
}

export interface EventProcessor<TCheckpoint extends Checkpoint, TRawMessage> {
  onRawMessage: (rawMessage: TRawMessage) => Promise<void>;
  drain: () => Promise<void>;
  getCheckpoint: () => TCheckpoint | null;
}

function isPlainRecord(value: unknown): value is TransformedRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeRecords(
  resource: string,
  records: unknown,
): TransformedRecord[] {
  if (!Array.isArray(records)) {
    throw new Error(
      `Resource '${resource}' process must return records as an array.`,
    );
  }

  if (!records.every(isPlainRecord)) {
    throw new Error(
      `Resource '${resource}' process returned a non-object record.`,
    );
  }

  return records;
}

function normalizeParsedPayloads<TPayload>(
  parsed: TPayload | TPayload[] | null | undefined,
): TPayload[] {
  if (parsed == null) {
    return [];
  }

  return Array.isArray(parsed) ? parsed : [parsed];
}

function assertUniqueResourceNames<
  TResource extends string,
  TRawMessage,
  TPayload,
  TCheckpoint extends Checkpoint,
>(
  resources: readonly WebSocketResourceDefinition<
    TResource,
    TRawMessage,
    TPayload,
    TCheckpoint
  >[],
): void {
  const names = new Set<string>();

  for (const resource of resources) {
    if (names.has(resource.name)) {
      throw new Error(`Duplicate resource definition '${resource.name}'.`);
    }

    names.add(resource.name);
  }
}

function normalizeProcessResult<TCheckpoint extends Checkpoint>(
  resource: string,
  result: ResourceProcessResult<TCheckpoint> | null,
): ResourceProcessResult<TCheckpoint> | null {
  if (result == null) {
    return null;
  }

  return {
    ...result,
    records: normalizeRecords(resource, result.records),
  };
}

export function createEventProcessor<
  TResource extends string,
  TRawMessage,
  TPayload,
  TCheckpoint extends Checkpoint,
>(
  options: EventProcessorOptions<TResource, TRawMessage, TPayload, TCheckpoint>,
): EventProcessor<TCheckpoint, TRawMessage> {
  let checkpoint = options.initialCheckpoint;
  let processingChain: Promise<void> = Promise.resolve();

  assertUniqueResourceNames(options.resources);

  const onRawMessage = async (rawMessage: TRawMessage): Promise<void> => {
    processingChain = processingChain.then(async () => {
      for (const resource of options.resources) {
        const payloads = normalizeParsedPayloads(resource.parse(rawMessage));

        for (const payload of payloads) {
          const result = normalizeProcessResult(
            resource.name,
            resource.process({
              payload,
              receivedAt: new Date(),
            }),
          );

          if (!result || result.records.length === 0) {
            continue;
          }

          await writeRecordsToDestination(
            resource.name,
            resource.sink,
            result.records,
          );

          if (result.checkpoint != null) {
            await options.checkpointStore.save(
              options.pipelineId,
              result.checkpoint,
            );
            checkpoint = result.checkpoint;
          }
        }
      }
    });

    try {
      await processingChain;
    } catch (error) {
      options.onProcessingError(error);
    }
  };

  return {
    onRawMessage,
    drain: async () => {
      await processingChain;
    },
    getCheckpoint: () => checkpoint,
  };
}
