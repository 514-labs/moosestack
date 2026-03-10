import {
  OlapTable,
  Stream,
  IngestApi,
  DeadLetterQueue,
} from "@514labs/moose-lib";
import {
  AircraftTrackingData,
  AircraftTrackingProcessed,
} from "../datamodels/models";
import { transformAircraft } from "../functions/process_aircraft";

// --- Raw data ingest pipeline ---

// Per `schema-pk-cardinality-order`: low cardinality first (aircraft_type),
// then medium (hex = ICAO address), then high (timestamp).
// Per `schema-pk-prioritize-filters`: hex and timestamp are the most common WHERE filters.
// Per `schema-partition-lifecycle`: monthly partitions for time-based data lifecycle.
export const AircraftTrackingDataTable = new OlapTable<AircraftTrackingData>(
  "AircraftTrackingDataTable",
  {
    orderByFields: ["aircraft_type", "hex", "timestamp"],
    partitionBy: "toStartOfMonth(timestamp)",
  },
);

export const AircraftTrackingDataStream = new Stream<AircraftTrackingData>(
  "AircraftTrackingDataStream",
  {
    destination: AircraftTrackingDataTable,
  },
);

export const AircraftTrackingDataIngestApi =
  new IngestApi<AircraftTrackingData>("AircraftTrackingDataIngestApi", {
    destination: AircraftTrackingDataStream,
    deadLetterQueue: new DeadLetterQueue<AircraftTrackingData>(
      "AircraftTrackingDataDLQ",
    ),
  });

// --- Processed data pipeline ---

// Per `schema-pk-cardinality-order`: zorderCoordinate enables spatial queries,
// combined with timestamp for time+space filtering.
export const AircraftTrackingProcessedTable =
  new OlapTable<AircraftTrackingProcessed>("AircraftTrackingProcessedTable", {
    orderByFields: ["aircraft_type", "hex", "timestamp"],
    partitionBy: "toStartOfMonth(timestamp)",
  });

export const AircraftTrackingProcessedStream =
  new Stream<AircraftTrackingProcessed>("AircraftTrackingProcessedStream", {
    destination: AircraftTrackingProcessedTable,
  });

// Wire the transform: raw → processed
AircraftTrackingDataStream.addTransform(
  AircraftTrackingProcessedStream,
  transformAircraft,
);
