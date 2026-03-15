import { ClickHouseEngines, OlapTable, Stream } from "@514labs/moose-lib";
import { defineWebSocketResource } from "../../shared/durable-pipeline/resource-definition";
import {
  CoinbaseCheckpoint,
  CoinbaseMatchPayload,
  CoinbaseMatchRecord,
} from "../types";
import { parseCoinbaseMatchPayloads } from "../validator";

export const CoinbaseMatchesTable = new OlapTable<CoinbaseMatchRecord>(
  "coinbase_matches_events",
  {
    engine: ClickHouseEngines.ReplacingMergeTree,
    orderByFields: ["product_id", "sequence"],
    ver: "cdc_timestamp",
    isDeleted: "is_deleted",
  },
);

export const CoinbaseMatchesStream = new Stream<CoinbaseMatchRecord>(
  "coinbase_matches_events_stream",
  {
    destination: CoinbaseMatchesTable,
  },
);

function toCoinbaseMatchRecord(
  payload: CoinbaseMatchPayload,
  receivedAt: Date,
): CoinbaseMatchRecord {
  const eventTime = new Date(payload.trade.time);
  const cdcTimestamp = new Date(payload.timestamp);

  return {
    trade_id: payload.trade.trade_id,
    sequence: payload.sequence_num,
    product_id: payload.trade.product_id,
    side: payload.trade.side === "BUY" ? "buy" : "sell",
    price: Number(payload.trade.price),
    size: Number(payload.trade.size),
    event_time: eventTime,
    received_at: receivedAt,
    payload_json: JSON.stringify(payload),
    cdc_operation: "INSERT",
    cdc_timestamp: cdcTimestamp,
    is_deleted: false,
  };
}

function checkpointFromCoinbaseMessage(
  payload: CoinbaseMatchPayload,
): CoinbaseCheckpoint {
  return {
    product_id: payload.trade.product_id,
    sequence: payload.sequence_num,
    event_time: payload.trade.time,
  };
}

export const matchesResource = defineWebSocketResource<
  "matches",
  unknown,
  CoinbaseMatchPayload,
  CoinbaseCheckpoint
>({
  name: "matches",
  sink: CoinbaseMatchesStream,
  parse: parseCoinbaseMatchPayloads,
  process: ({ payload, receivedAt }) => ({
    records: [toCoinbaseMatchRecord(payload, receivedAt)],
    checkpoint: checkpointFromCoinbaseMessage(payload),
  }),
});
