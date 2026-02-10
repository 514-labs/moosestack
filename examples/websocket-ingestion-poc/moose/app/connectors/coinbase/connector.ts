import { ConnectorPipelineOptions } from "../shared/durable-pipeline/connector-pipeline";
import { defineConnector } from "../shared/durable-pipeline/connector-definition";
import { COINBASE_RESOURCES } from "./sinks";
import { coinbaseSource } from "./source";
import {
  CoinbaseCheckpoint,
  CoinbaseMatchRecord,
  CoinbaseResourceName,
} from "./types";

const PIPELINE_ID = "coinbase-trades-listener";

export type CoinbasePipelineOptions = ConnectorPipelineOptions<
  CoinbaseResourceName,
  CoinbaseMatchRecord,
  CoinbaseCheckpoint
>;

const coinbaseConnector = defineConnector<
  CoinbaseResourceName,
  CoinbaseMatchRecord,
  CoinbaseCheckpoint
>({
  pipelineId: PIPELINE_ID,
  workflowName: "coinbase-trades-listener",
  taskName: "run-coinbase-trades-listener",
  source: coinbaseSource,
  defaultResources: COINBASE_RESOURCES,
  defaultCheckpointKeyPrefix: "coinbase-matches-checkpoint",
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
export const coinbaseTradesListenerWorkflow = coinbaseConnector.workflow;
