/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />

import { expect } from "chai";
import * as path from "path";

type Checkpoint = Record<string, unknown>;
type ResourceKey = "default";
type Payload = Record<string, unknown>;

interface SourceEnvelope {
  resource: ResourceKey;
  payload: Payload;
  checkpoint?: Checkpoint | null;
}

interface SourceStartContext {
  fromCheckpoint: Checkpoint | null;
  onEvent: (event: SourceEnvelope) => Promise<void>;
  onDisconnect: (error?: unknown) => void;
  signal: AbortSignal;
}

interface SourceHandle {
  stop: () => Promise<void>;
}

interface ReconnectPolicy {
  initialMs: number;
  maxMs: number;
  multiplier: number;
  jitter: number;
}

interface StreamDestination {
  send: (record: Record<string, unknown>) => Promise<void>;
}

interface ResourceDefinition {
  destination: StreamDestination;
  transform?: (
    payload: Payload,
    envelope: SourceEnvelope,
  ) => Record<string, unknown> | Record<string, unknown>[] | null;
}

interface DurablePipelineConfig {
  pipelineId: string;
  source: {
    start: (context: SourceStartContext) => Promise<SourceHandle>;
  };
  checkpointStore: {
    load: (pipelineId: string) => Promise<Checkpoint | null>;
    save: (pipelineId: string, checkpoint: Checkpoint) => Promise<void>;
  };
  resources: {
    default: ResourceDefinition;
  };
  onError?: (error: unknown) => void;
  reconnectPolicy?: ReconnectPolicy;
}

interface PipelineControl {
  stop: () => Promise<void>;
  done: Promise<void>;
}

interface DurablePipelineModule {
  runDurablePipeline: (
    config: DurablePipelineConfig,
  ) => Promise<PipelineControl>;
}

const runtimeModulePath = path.resolve(
  __dirname,
  "../../../examples/websocket-ingestion-poc/moose/app/connectors/shared/durable-pipeline/runner",
);

describe("Durable Listener Runtime", function () {
  this.timeout(30_000);

  function getRuntimeModule(): DurablePipelineModule {
    return require(runtimeModulePath) as DurablePipelineModule;
  }

  it("routes source envelope payloads and saves checkpoint after sink write", async function () {
    const { runDurablePipeline } = getRuntimeModule();
    const writes: Record<string, unknown>[] = [];
    const checkpoints: Checkpoint[] = [];

    let disconnect!: (error?: unknown) => void;
    let emit!: (event: SourceEnvelope) => Promise<void>;

    const pipeline = await runDurablePipeline({
      pipelineId: "test-source",
      source: {
        start: async (context) => {
          disconnect = context.onDisconnect;
          emit = context.onEvent;
          return {
            stop: async () => {},
          };
        },
      },
      resources: {
        default: {
          destination: {
            send: async (record) => {
              writes.push(record);
            },
          },
        },
      },
      checkpointStore: {
        load: async () => null,
        save: async (_pipelineId, checkpoint) => {
          checkpoints.push(checkpoint);
        },
      },
      reconnectPolicy: { initialMs: 5, maxMs: 20, multiplier: 2, jitter: 0 },
    });

    await emit({
      resource: "default",
      payload: { sequence: 1, value: "A" },
      checkpoint: { sequence: 1 },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    disconnect();
    await pipeline.stop();
    await pipeline.done;

    expect(writes).to.have.length(1);
    expect(writes[0]).to.deep.equal({ sequence: 1, value: "A" });
    expect(checkpoints).to.deep.equal([{ sequence: 1 }]);
  });

  it("supports per-resource transform fan-out and null-drop", async function () {
    const { runDurablePipeline } = getRuntimeModule();
    const writes: Record<string, unknown>[] = [];
    const checkpoints: Checkpoint[] = [];

    let disconnect!: (error?: unknown) => void;
    let emit!: (event: SourceEnvelope) => Promise<void>;

    const pipeline = await runDurablePipeline({
      pipelineId: "transform-source",
      source: {
        start: async (context) => {
          disconnect = context.onDisconnect;
          emit = context.onEvent;
          return {
            stop: async () => {},
          };
        },
      },
      resources: {
        default: {
          destination: {
            send: async (record) => {
              writes.push(record);
            },
          },
          transform: (payload) => {
            if (payload.kind === "drop") {
              return null;
            }

            if (payload.kind === "fanout") {
              return [
                { id: `${payload.id}-1`, value: payload.value },
                { id: `${payload.id}-2`, value: payload.value },
              ];
            }

            return { id: payload.id, value: payload.value };
          },
        },
      },
      checkpointStore: {
        load: async () => null,
        save: async (_pipelineId, checkpoint) => {
          checkpoints.push(checkpoint);
        },
      },
      reconnectPolicy: { initialMs: 5, maxMs: 20, multiplier: 2, jitter: 0 },
    });

    await emit({
      resource: "default",
      payload: { kind: "single", id: "a", value: 10 },
      checkpoint: { sequence: 1 },
    });
    await emit({
      resource: "default",
      payload: { kind: "fanout", id: "b", value: 20 },
      checkpoint: { sequence: 2 },
    });
    await emit({
      resource: "default",
      payload: { kind: "drop", id: "c", value: 30 },
      checkpoint: { sequence: 3 },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    disconnect();
    await pipeline.stop();
    await pipeline.done;

    expect(writes).to.deep.equal([
      { id: "a", value: 10 },
      { id: "b-1", value: 20 },
      { id: "b-2", value: 20 },
    ]);
    expect(checkpoints).to.deep.equal([{ sequence: 1 }, { sequence: 2 }]);
  });

  it("supports writes without checkpoint when envelope checkpoint is omitted", async function () {
    const { runDurablePipeline } = getRuntimeModule();
    const writes: Record<string, unknown>[] = [];
    const checkpoints: Checkpoint[] = [];

    let disconnect!: (error?: unknown) => void;
    let emit!: (event: SourceEnvelope) => Promise<void>;

    const pipeline = await runDurablePipeline({
      pipelineId: "records-only-source",
      source: {
        start: async (context) => {
          disconnect = context.onDisconnect;
          emit = context.onEvent;
          return {
            stop: async () => {},
          };
        },
      },
      resources: {
        default: {
          destination: {
            send: async (record) => {
              writes.push(record);
            },
          },
        },
      },
      checkpointStore: {
        load: async () => null,
        save: async (_pipelineId, checkpoint) => {
          checkpoints.push(checkpoint);
        },
      },
      reconnectPolicy: { initialMs: 5, maxMs: 20, multiplier: 2, jitter: 0 },
    });

    await emit({
      resource: "default",
      payload: { kind: "records-only", value: "ok" },
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    disconnect();
    await pipeline.stop();
    await pipeline.done;

    expect(writes).to.deep.equal([{ kind: "records-only", value: "ok" }]);
    expect(checkpoints).to.deep.equal([]);
  });

  it("does not save checkpoint when sink write fails and reconnects from last persisted checkpoint", async function () {
    const { runDurablePipeline } = getRuntimeModule();
    const checkpoints: Checkpoint[] = [];
    const startCheckpoints: Array<Checkpoint | null> = [];
    const eventsByConnection: Array<(event: SourceEnvelope) => Promise<void>> =
      [];
    const disconnectsByConnection: Array<(error?: unknown) => void> = [];

    let writeAttempts = 0;
    let persistedCheckpoint: Checkpoint | null = null;

    const pipeline = await runDurablePipeline({
      pipelineId: "reconnect-source",
      source: {
        start: async (context) => {
          startCheckpoints.push(context.fromCheckpoint);
          eventsByConnection.push(context.onEvent);
          disconnectsByConnection.push(context.onDisconnect);
          return {
            stop: async () => {},
          };
        },
      },
      resources: {
        default: {
          destination: {
            send: async () => {
              writeAttempts += 1;
              if (writeAttempts === 2) {
                throw new Error("intentional write failure");
              }
            },
          },
        },
      },
      checkpointStore: {
        load: async () => persistedCheckpoint,
        save: async (_pipelineId, checkpoint) => {
          persistedCheckpoint = checkpoint;
          checkpoints.push(checkpoint);
        },
      },
      reconnectPolicy: { initialMs: 5, maxMs: 20, multiplier: 2, jitter: 0 },
    });

    await eventsByConnection[0]({
      resource: "default",
      payload: { sequence: 1, value: "ok" },
      checkpoint: { sequence: 1 },
    });
    await eventsByConnection[0]({
      resource: "default",
      payload: { sequence: 2, value: "boom" },
      checkpoint: { sequence: 2 },
    });
    disconnectsByConnection[0](new Error("socket disconnected"));
    await new Promise((resolve) => setTimeout(resolve, 25));
    await pipeline.stop();
    await pipeline.done;

    expect(checkpoints).to.deep.equal([{ sequence: 1 }]);
    expect(startCheckpoints[0]).to.equal(null);
    expect(startCheckpoints[1]).to.deep.equal({ sequence: 1 });
  });
});
