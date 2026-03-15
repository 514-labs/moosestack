import { ConnectorPipelineOptions } from "../shared/durable-pipeline/connector-pipeline";
import { defineWebSocketConnector } from "../shared/durable-pipeline/connector-definition";
import { coinbaseSource } from "./source";
import {
  CoinbaseCheckpoint,
  CoinbaseMatchPayload,
  CoinbaseResourceName,
} from "./types";

const PIPELINE_ID = "coinbase-trades-listener";

export type CoinbasePipelineOptions =
  ConnectorPipelineOptions<CoinbaseCheckpoint>;

export const coinbaseConnector = defineWebSocketConnector<
  CoinbaseResourceName,
  unknown,
  CoinbaseMatchPayload,
  CoinbaseCheckpoint
>({
  pipelineId: PIPELINE_ID,
  workflowName: "coinbase-trades-listener",
  taskName: "run-coinbase-trades-listener",
  source: coinbaseSource,
  checkpointStoreKeyPrefix: "coinbase-matches-checkpoint",
  reconnectPolicy: {
    initialMs: 1_000,
    maxMs: 30_000,
    multiplier: 2,
    jitter: 0.2,
  },
  onError: (error) => {
    console.error("Coinbase pipeline error", error);
  },
});

export const createCoinbasePipeline = coinbaseConnector.createPipeline;
export const startCoinbasePipeline = coinbaseConnector.startPipeline;
