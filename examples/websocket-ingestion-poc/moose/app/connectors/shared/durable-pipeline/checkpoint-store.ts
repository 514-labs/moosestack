import { MooseCache } from "@514labs/moose-lib";
import { Checkpoint, CheckpointStore } from "./types";

const DEFAULT_KEY_PREFIX = "durable-pipeline-checkpoint";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 365;

export interface MooseCacheCheckpointStoreOptions {
  keyPrefix?: string;
  ttlSeconds?: number;
}

function checkpointKey(prefix: string, pipelineId: string): string {
  return `${prefix}:${pipelineId}`;
}

export function createMooseCacheCheckpointStore<
  TCheckpoint extends Checkpoint = Checkpoint,
>(options?: MooseCacheCheckpointStoreOptions): CheckpointStore<TCheckpoint> {
  const keyPrefix = options?.keyPrefix ?? DEFAULT_KEY_PREFIX;
  const ttlSeconds = options?.ttlSeconds ?? DEFAULT_TTL_SECONDS;

  return {
    load: async (pipelineId: string) => {
      const cache = await MooseCache.get();
      return cache.get<TCheckpoint>(checkpointKey(keyPrefix, pipelineId));
    },
    save: async (pipelineId: string, checkpoint: TCheckpoint) => {
      const cache = await MooseCache.get();
      await cache.set(
        checkpointKey(keyPrefix, pipelineId),
        checkpoint,
        ttlSeconds,
      );
    },
  };
}
