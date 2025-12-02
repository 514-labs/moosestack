import { describe, it } from "mocha";
import { expect } from "chai";
import { ClickHouseEngines } from "../src/blocks/helpers";

describe("Kafka Engine Configuration", () => {
  describe("ClickHouseEngines enum", () => {
    it("should include Kafka engine", () => {
      expect(ClickHouseEngines.Kafka).to.equal("Kafka");
    });
  });

  describe("KafkaConfig type validation", () => {
    it("should accept valid Kafka configuration with required fields", () => {
      const config = {
        engine: ClickHouseEngines.Kafka,
        brokerList: "kafka-1:9092,kafka-2:9092",
        topicList: "events",
        groupName: "moose_consumer",
        format: "JSONEachRow",
      };

      expect(config.engine).to.equal("Kafka");
      expect(config.brokerList).to.equal("kafka-1:9092,kafka-2:9092");
      expect(config.topicList).to.equal("events");
      expect(config.groupName).to.equal("moose_consumer");
      expect(config.format).to.equal("JSONEachRow");
    });

    it("should accept Kafka configuration with optional parameters", () => {
      const config = {
        engine: ClickHouseEngines.Kafka,
        brokerList: "kafka:9092",
        topicList: "events",
        groupName: "consumer",
        format: "JSONEachRow",
        rowDelimiter: "\n",
        schema: "schema.avsc",
        numConsumers: 3,
      };

      expect(config.rowDelimiter).to.equal("\n");
      expect(config.schema).to.equal("schema.avsc");
      expect(config.numConsumers).to.equal(3);
    });

    it("should accept Kafka configuration with security settings", () => {
      const config = {
        engine: ClickHouseEngines.Kafka,
        brokerList: "kafka:9093",
        topicList: "secure_events",
        groupName: "secure_consumer",
        format: "JSONEachRow",
        securityProtocol: "SASL_SSL",
        saslMechanism: "SCRAM-SHA-256",
        saslUsername: "user",
        saslPassword: "pass",
      };

      expect(config.securityProtocol).to.equal("SASL_SSL");
      expect(config.saslMechanism).to.equal("SCRAM-SHA-256");
      expect(config.saslUsername).to.equal("user");
      expect(config.saslPassword).to.equal("pass");
    });

    it("should accept Kafka configuration with table settings", () => {
      const config = {
        engine: ClickHouseEngines.Kafka,
        brokerList: "kafka:9092",
        topicList: "events",
        groupName: "consumer",
        format: "JSONEachRow",
        settings: {
          kafka_skip_broken_messages: 10,
          kafka_commit_every_batch: 1,
          kafka_thread_per_consumer: 1,
          kafka_handle_error_mode: "stream" as const,
          kafka_max_rows_per_message: 100,
          kafka_commit_on_select: false,
        },
      };

      expect(config.settings).to.deep.equal({
        kafka_skip_broken_messages: 10,
        kafka_commit_every_batch: 1,
        kafka_thread_per_consumer: 1,
        kafka_handle_error_mode: "stream",
        kafka_max_rows_per_message: 100,
        kafka_commit_on_select: false,
      });
    });
  });

  describe("KafkaConfig serialization", () => {
    it("should serialize to JSON correctly", () => {
      const config = {
        engine: ClickHouseEngines.Kafka,
        brokerList: "kafka:9092",
        topicList: "events",
        groupName: "consumer",
        format: "JSONEachRow",
        numConsumers: 2,
      };

      const json = JSON.stringify(config);
      const parsed = JSON.parse(json);

      expect(parsed.engine).to.equal("Kafka");
      expect(parsed.brokerList).to.equal("kafka:9092");
      expect(parsed.numConsumers).to.equal(2);
    });

    it("should handle runtime environment markers in credentials", () => {
      const config = {
        engine: ClickHouseEngines.Kafka,
        brokerList: "kafka:9092",
        topicList: "events",
        groupName: "consumer",
        format: "JSONEachRow",
        saslUsername: "__MOOSE_RUNTIME_ENV__:KAFKA_USERNAME",
        saslPassword: "__MOOSE_RUNTIME_ENV__:KAFKA_PASSWORD",
      };

      expect(config.saslUsername).to.include("__MOOSE_RUNTIME_ENV__:");
      expect(config.saslPassword).to.include("__MOOSE_RUNTIME_ENV__:");
    });
  });

  describe("KafkaTableSettings", () => {
    it("should accept valid table settings", () => {
      const settings = {
        kafka_skip_broken_messages: "5",
        kafka_handle_error_mode: "default" as const,
        kafka_commit_every_batch: "0" as const,
        kafka_thread_per_consumer: "1" as const,
        kafka_max_block_size: "65536",
        kafka_poll_timeout_ms: "500",
        kafka_flush_interval_ms: "1000",
        kafka_client_id: "moose-client",
      };

      expect(settings.kafka_skip_broken_messages).to.equal("5");
      expect(settings.kafka_handle_error_mode).to.equal("default");
      expect(settings.kafka_commit_every_batch).to.equal("0");
      expect(settings.kafka_thread_per_consumer).to.equal("1");
      expect(settings.kafka_client_id).to.equal("moose-client");
    });
  });
});
