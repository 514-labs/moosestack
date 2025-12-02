/**
 * Kafka Engine E2E Test
 *
 * Tests the Kafka table engine integration by:
 * 1. Creating a Stream that writes to Redpanda (creates topic)
 * 2. Creating a Kafka table that reads from the same topic
 * 3. Creating a MaterializedView to persist data from Kafka to MergeTree
 * 4. E2E test sends data via ingest API → verifies it lands in the MergeTree table
 *
 * This uses Moose's built-in Redpanda instance (internal address: redpanda:9092)
 */

import {
  Stream,
  IngestApi,
  OlapTable,
  MaterializedView,
  ClickHouseEngines,
  Key,
  sql,
} from "@514labs/moose-lib";

/**
 * Event data model for Kafka test
 * Note: timestamp is Unix seconds (not DateTime) for Kafka engine JSONEachRow parsing
 */
export interface KafkaTestEvent {
  eventId: Key<string>;
  userId: string;
  eventType: string;
  amount: number;
  timestamp: number; // Unix timestamp (seconds)
}

/**
 * 1. Stream: Creates the Redpanda topic "KafkaTestInput_1"
 * Data sent via IngestApi goes here first
 */
export const kafkaTestInputStream = new Stream<KafkaTestEvent>(
  "KafkaTestInput",
);

/**
 * 2. IngestApi: HTTP endpoint to send test data
 * POST /ingest/kafka-test → writes to kafkaTestInputStream
 */
export const kafkaTestIngestApi = new IngestApi<KafkaTestEvent>("kafka-test", {
  destination: kafkaTestInputStream,
});

/**
 * 3. Kafka Table: Reads from the same topic the Stream writes to
 * Uses ClickHouse's Kafka engine to consume from "KafkaTestInput_1"
 *
 * Note: brokerList uses internal Docker address since both
 * ClickHouse and Redpanda are in the same docker-compose network
 */
export const KafkaTestSourceTable = new OlapTable<KafkaTestEvent>(
  "KafkaTestSource",
  {
    engine: ClickHouseEngines.Kafka,
    brokerList: "redpanda:9092", // Internal Docker network address
    topicList: "KafkaTestInput", // Must match Stream's topic name
    groupName: "e2e_kafka_test_consumer",
    format: "JSONEachRow",
    settings: {
      kafka_num_consumers: "1",
    },
  },
);

/**
 * 4. MaterializedView: Continuously moves data from Kafka table to MergeTree
 * This is what makes the continuous data flow work:
 * Redpanda topic → Kafka table → MV → MergeTree table
 */
const kafkaSourceColumns = KafkaTestSourceTable.columns;

export const KafkaTestMV = new MaterializedView<KafkaTestEvent>({
  tableName: "KafkaTestDest",
  materializedViewName: "KafkaTestDest_MV",
  orderByFields: ["eventId", "timestamp"],
  selectStatement: sql`
    SELECT
      ${kafkaSourceColumns.eventId} as eventId,
      ${kafkaSourceColumns.userId} as userId,
      ${kafkaSourceColumns.eventType} as eventType,
      ${kafkaSourceColumns.amount} as amount,
      ${kafkaSourceColumns.timestamp} as timestamp
    FROM ${KafkaTestSourceTable}
  `,
  selectTables: [KafkaTestSourceTable],
});
