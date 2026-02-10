import { ClickHouseEngines, OlapTable, Stream } from "@514labs/moose-lib";
import { ResourceDefinitions } from "../shared/durable-pipeline/types";
import {
  CoinbaseCheckpoint,
  CoinbaseMatchRecord,
  CoinbaseResourceName,
} from "./types";

export type CoinbaseSinkKey = CoinbaseResourceName;

// Destination resources (Moose sinks)
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

// Source channel -> destination object map (single source of truth for where data lands)
export const COINBASE_RESOURCES = {
  matches: {
    destination: CoinbaseMatchesStream,
  },
} satisfies ResourceDefinitions<
  CoinbaseResourceName,
  CoinbaseMatchRecord,
  CoinbaseCheckpoint
>;
