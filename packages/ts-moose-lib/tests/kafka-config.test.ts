/**
 * Tests for Kafka engine configuration.
 */

import { expect } from "chai";
import { OlapTable, Key, ClickHouseEngines } from "../src/index";
import { getMooseInternal, toInfraMap } from "../src/dmv2/internal";
import { Column } from "../src/dataModels/dataModelTypes";
import { IJsonSchemaCollection } from "typia/src/schemas/json/IJsonSchemaCollection";

// Mock schema and columns for testing
const createMockSchema = (): IJsonSchemaCollection.IV3_1 => ({
  version: "3.1",
  components: { schemas: {} },
  schemas: [{ type: "object", properties: {} }],
});

const createMockColumns = (fields: string[]): Column[] =>
  fields.map((field) => ({
    name: field as any,
    data_type: "String" as any,
    required: true,
    unique: false,
    primary_key: false,
    default: null,
    ttl: null,
    annotations: [],
  }));

const createTestOlapTable = <T>(
  name: string,
  config: any,
  fields: string[] = ["id", "message", "timestamp"],
) => {
  return new OlapTable<T>(
    name,
    config,
    createMockSchema(),
    createMockColumns(fields),
  );
};

interface KafkaEvent {
  id: Key<string>;
  message: string;
  timestamp: number;
}

describe("Kafka Engine Configuration", () => {
  beforeEach(() => {
    getMooseInternal().tables.clear();
  });

  describe("Basic Configuration", () => {
    it("should create table with minimal required Kafka settings", () => {
      const table = createTestOlapTable<KafkaEvent>("KafkaMinimal", {
        engine: ClickHouseEngines.Kafka,
        settings: {
          kafka_broker_list: "localhost:9092",
          kafka_topic_list: "test_topic",
          kafka_group_name: "test_group",
          kafka_format: "JSONEachRow",
        },
      });

      expect(table.name).to.equal("KafkaMinimal");
      expect((table.config as any).engine).to.equal(ClickHouseEngines.Kafka);
      expect((table.config as any).settings.kafka_broker_list).to.equal(
        "localhost:9092",
      );
    });

    it("should create table with comprehensive Kafka configuration", () => {
      const table = createTestOlapTable<KafkaEvent>("KafkaFull", {
        engine: ClickHouseEngines.Kafka,
        settings: {
          // Required
          kafka_broker_list: "broker1:9092,broker2:9092",
          kafka_topic_list: "topic1,topic2",
          kafka_group_name: "consumer_group",
          kafka_format: "JSONEachRow",
          // Security
          kafka_security_protocol: "sasl_ssl",
          kafka_sasl_mechanism: "SCRAM-SHA-256",
          kafka_sasl_username: "user",
          kafka_sasl_password: "pass",
          // Consumer settings
          kafka_num_consumers: "4",
          kafka_max_block_size: "65536",
          kafka_skip_broken_messages: "10",
          kafka_handle_error_mode: "stream",
          // Compression
          kafka_compression_codec: "snappy",
          // Schema registry
          kafka_schema: "schema.avsc:Message",
          kafka_schema_registry_skip_bytes: "5",
          // Keeper storage (experimental)
          kafka_keeper_path: "/clickhouse/kafka/offsets",
          kafka_replica_name: "replica1",
        },
      });

      const settings = (table.config as any).settings;
      expect(settings.kafka_security_protocol).to.equal("sasl_ssl");
      expect(settings.kafka_num_consumers).to.equal("4");
      expect(settings.kafka_compression_codec).to.equal("snappy");
      expect(settings.kafka_schema).to.equal("schema.avsc:Message");
      expect(settings.kafka_keeper_path).to.equal("/clickhouse/kafka/offsets");
    });
  });

  describe("Infrastructure Map Serialization", () => {
    it("should correctly serialize Kafka engine and settings to infrastructure map", () => {
      const table = createTestOlapTable<KafkaEvent>("KafkaInfra", {
        engine: ClickHouseEngines.Kafka,
        settings: {
          kafka_broker_list: "localhost:9092",
          kafka_topic_list: "events",
          kafka_group_name: "moose_consumers",
          kafka_format: "JSONEachRow",
          kafka_num_consumers: "2",
        },
        version: "1.0",
      });

      const infraMap = toInfraMap(getMooseInternal());
      const tableConfig = infraMap.tables["KafkaInfra_1.0"];

      expect(tableConfig.name).to.equal("KafkaInfra");
      expect(tableConfig.version).to.equal("1.0");
      expect(tableConfig.engineConfig?.engine).to.equal("Kafka");

      // Verify all settings are preserved
      expect(tableConfig.tableSettings?.kafka_broker_list).to.equal(
        "localhost:9092",
      );
      expect(tableConfig.tableSettings?.kafka_topic_list).to.equal("events");
      expect(tableConfig.tableSettings?.kafka_group_name).to.equal(
        "moose_consumers",
      );
      expect(tableConfig.tableSettings?.kafka_format).to.equal("JSONEachRow");
      expect(tableConfig.tableSettings?.kafka_num_consumers).to.equal("2");

      // Verify unsupported clauses are not present
      expect(tableConfig.orderBy).to.satisfy((orderBy: any) => {
        return (
          orderBy === undefined ||
          orderBy === "" ||
          (Array.isArray(orderBy) && orderBy.length === 0)
        );
      });
      expect(tableConfig.partitionBy).to.be.undefined;
      expect(tableConfig.sampleByExpression).to.be.undefined;
    });
  });

  describe("Kafka Engine Restrictions", () => {
    it("should omit ORDER BY, PARTITION BY, and SAMPLE BY for Kafka tables", () => {
      const table = createTestOlapTable<KafkaEvent>("KafkaRestricted", {
        engine: ClickHouseEngines.Kafka,
        settings: {
          kafka_broker_list: "localhost:9092",
          kafka_topic_list: "test",
          kafka_group_name: "group",
          kafka_format: "JSONEachRow",
        },
        // These clauses should be omitted per KafkaConfig type definition
      });

      const infraMap = toInfraMap(getMooseInternal());
      const tableConfig = infraMap.tables["KafkaRestricted"];

      // Kafka doesn't support these clauses
      expect(tableConfig.partitionBy).to.be.undefined;
      expect(tableConfig.sampleByExpression).to.be.undefined;
    });
  });

  describe("Multiple Kafka Tables", () => {
    it("should support multiple Kafka tables with different configurations", () => {
      const table1 = createTestOlapTable<KafkaEvent>("KafkaTopic1", {
        engine: ClickHouseEngines.Kafka,
        settings: {
          kafka_broker_list: "localhost:9092",
          kafka_topic_list: "topic_1",
          kafka_group_name: "group_1",
          kafka_format: "JSONEachRow",
        },
      });

      const table2 = createTestOlapTable<KafkaEvent>("KafkaTopic2", {
        engine: ClickHouseEngines.Kafka,
        settings: {
          kafka_broker_list: "localhost:9092",
          kafka_topic_list: "topic_2",
          kafka_group_name: "group_2",
          kafka_format: "CSV",
          kafka_num_consumers: "8",
          kafka_security_protocol: "ssl",
        },
      });

      const tables = getMooseInternal().tables;
      expect(tables.has("KafkaTopic1")).to.be.true;
      expect(tables.has("KafkaTopic2")).to.be.true;

      const infraMap = toInfraMap(getMooseInternal());

      // Verify distinct configurations
      expect(
        infraMap.tables["KafkaTopic1"].tableSettings?.kafka_topic_list,
      ).to.equal("topic_1");
      expect(
        infraMap.tables["KafkaTopic2"].tableSettings?.kafka_topic_list,
      ).to.equal("topic_2");
      expect(
        infraMap.tables["KafkaTopic2"].tableSettings?.kafka_format,
      ).to.equal("CSV");
      expect(
        infraMap.tables["KafkaTopic2"].tableSettings?.kafka_num_consumers,
      ).to.equal("8");
      expect(infraMap.tables["KafkaTopic1"].tableSettings?.kafka_num_consumers)
        .to.be.undefined;
    });
  });

  describe("Database and Version Support", () => {
    it("should handle Kafka table with database and version", () => {
      const table = createTestOlapTable<KafkaEvent>("KafkaDbVersion", {
        engine: ClickHouseEngines.Kafka,
        database: "analytics",
        version: "2.0",
        settings: {
          kafka_broker_list: "localhost:9092",
          kafka_topic_list: "events",
          kafka_group_name: "group",
          kafka_format: "JSONEachRow",
        },
      });

      const infraMap = toInfraMap(getMooseInternal());
      const tableConfig = infraMap.tables["KafkaDbVersion_2.0"];

      expect(tableConfig.database).to.equal("analytics");
      expect(tableConfig.version).to.equal("2.0");
      expect(tableConfig.engineConfig?.engine).to.equal("Kafka");
    });
  });
});
