import { Key, IngestPipeline } from "@514labs/moose-lib";

interface AccelerometerData {
  x: number;
  y: number;
  z: number;
}

interface GyroscopeData {
  x: number;
  y: number;
  z: number;
}

interface PpmData {
  channel1: number;
  channel2: number;
  channel3: number;
}

export interface Brain {
  sessionId: Key<string>;
  timestamp: Date;
  bandOn: boolean;
  acc: AccelerometerData;
  gyro: GyroscopeData;
  alpha: number;
  beta: number;
  delta: number;
  theta: number;
  gamma: number;
  ppm: PpmData;
}
// DMV2 Pipeline for Brain data
export const BrainPipeline = new IngestPipeline<Brain>("Brain", {
  table: {
    orderByFields: ["sessionId", "timestamp"],
  },
  stream: true,
  ingestAPI: true, // POST /ingest/Brain
});
