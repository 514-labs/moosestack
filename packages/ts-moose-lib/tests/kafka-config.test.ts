import { expect } from "chai";
import { OlapTable, ClickHouseEngines } from "../src";

interface TestEvent {
  event_id: string;
  user_id: string;
  event_type: string;
  amount: number;
  timestamp: number;
}

describe("Kafka Engine Configuration", () => {
  it("should create table with required fields", () => {
    const table = new OlapTable<TestEvent>("kafka_events", {
      engine: ClickHouseEngines.Kafka,
      brokerList: "kafka:9092",
      topicList: "events",
      groupName: "moose_consumer",
      format: "JSONEachRow",
    });

    expect(table.name).to.equal("kafka_events");
    expect((table.config as any).engine).to.equal(ClickHouseEngines.Kafka);
    expect((table.config as any).brokerList).to.equal("kafka:9092");
    expect((table.config as any).topicList).to.equal("events");
    expect((table.config as any).groupName).to.equal("moose_consumer");
    expect((table.config as any).format).to.equal("JSONEachRow");
  });

  it("should create table with settings", () => {
    const table = new OlapTable<TestEvent>("with_settings", {
      engine: ClickHouseEngines.Kafka,
      brokerList: "kafka:9093",
      topicList: "events",
      groupName: "consumer",
      format: "JSONEachRow",
      settings: {
        kafka_num_consumers: "2",
        kafka_skip_broken_messages: "10",
        kafka_security_protocol: "SASL_SSL",
        kafka_sasl_mechanism: "SCRAM-SHA-256",
        kafka_sasl_username: "user",
        kafka_sasl_password: "pass",
      },
    });

    expect((table.config as any).settings.kafka_num_consumers).to.equal("2");
    expect((table.config as any).settings.kafka_security_protocol).to.equal(
      "SASL_SSL",
    );
  });
});
