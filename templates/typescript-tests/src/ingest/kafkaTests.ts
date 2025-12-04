import {
  Stream,
  IngestApi,
  OlapTable,
  MaterializedView,
  ClickHouseEngines,
  Key,
  sql,
} from "@514labs/moose-lib";

export interface KafkaTestEvent {
  eventId: Key<string>;
  userId: string;
  eventType: string;
  amount: number;
  timestamp: number;
}

const KAFKA_TOPIC_NAME = "KafkaTestInput";

export const kafkaTestInputStream = new Stream<KafkaTestEvent>(
  KAFKA_TOPIC_NAME,
);

export const kafkaTestIngestApi = new IngestApi<KafkaTestEvent>("kafka-test", {
  destination: kafkaTestInputStream,
});

export const KafkaTestSourceTable = new OlapTable<KafkaTestEvent>(
  "KafkaTestSource",
  {
    engine: ClickHouseEngines.Kafka,
    brokerList: "redpanda:9092",
    topicList: KAFKA_TOPIC_NAME,
    groupName: "e2e_kafka_test_consumer",
    format: "JSONEachRow",
    settings: {
      kafka_num_consumers: "1",
    },
  },
);

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
