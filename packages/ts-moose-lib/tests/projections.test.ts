/**
 * Tests for OlapTable projection functionality.
 *
 * This test module verifies that projections can be defined on tables
 * and are correctly serialized to the infrastructure map.
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
    codec: null,
    materialized: null,
    annotations: [],
    comment: null,
  }));

const createTestOlapTable = <T>(
  name: string,
  config: any,
  fields: string[] = ["userId", "timestamp", "eventType", "value"],
) => {
  return new OlapTable<T>(
    name,
    config,
    createMockSchema(),
    createMockColumns(fields),
  );
};

interface UserEvent {
  userId: Key<string>;
  timestamp: Date;
  eventType: string;
  value: number;
}

describe("OlapTable Projections", () => {
  beforeEach(() => {
    getMooseInternal().tables.clear();
  });

  describe("Simple Field List Projections", () => {
    it("should create projections with field arrays", () => {
      createTestOlapTable<UserEvent>("Events", {
        engine: ClickHouseEngines.MergeTree,
        orderByFields: ["timestamp"],
        projections: [
          {
            name: "by_user",
            select: ["userId", "timestamp", "eventType"],
            orderBy: ["userId", "timestamp"],
          },
        ],
      });

      const tables = getMooseInternal().tables;
      expect(tables.has("Events")).to.be.true;

      const registeredTable = tables.get("Events");
      expect(registeredTable!.config.projections).to.have.lengthOf(1);
      expect(registeredTable!.config.projections![0].name).to.equal("by_user");
      expect(registeredTable!.config.projections![0].select).to.deep.equal([
        "userId",
        "timestamp",
        "eventType",
      ]);
      expect(registeredTable!.config.projections![0].orderBy).to.deep.equal([
        "userId",
        "timestamp",
      ]);
    });

    it("should support multiple projections on one table", () => {
      createTestOlapTable<UserEvent>("Events2", {
        engine: ClickHouseEngines.MergeTree,
        orderByFields: ["timestamp"],
        projections: [
          {
            name: "by_user",
            select: ["userId", "timestamp"],
            orderBy: ["userId"],
          },
          {
            name: "by_event",
            select: ["eventType", "timestamp"],
            orderBy: ["eventType"],
          },
        ],
      });

      const tables = getMooseInternal().tables;
      const registeredTable = tables.get("Events2");

      expect(registeredTable!.config.projections).to.have.lengthOf(2);
      expect(registeredTable!.config.projections![0].name).to.equal("by_user");
      expect(registeredTable!.config.projections![1].name).to.equal("by_event");
    });
  });

  describe("Expression-Based Projections", () => {
    it("should create projections with SQL expressions", () => {
      createTestOlapTable<UserEvent>("Events3", {
        engine: ClickHouseEngines.MergeTree,
        orderByFields: ["timestamp"],
        projections: [
          {
            name: "hourly_metrics",
            select:
              "toStartOfHour(timestamp) as hour, count() as cnt, sum(value) as total",
            orderBy: "hour",
            groupBy: "hour",
          },
        ],
      });

      const tables = getMooseInternal().tables;
      const registeredTable = tables.get("Events3");

      expect(registeredTable!.config.projections).to.have.lengthOf(1);
      expect(registeredTable!.config.projections![0].name).to.equal(
        "hourly_metrics",
      );
      expect(registeredTable!.config.projections![0].select).to.be.a("string");
      expect(registeredTable!.config.projections![0].select).to.include(
        "toStartOfHour",
      );
      expect(registeredTable!.config.projections![0].groupBy).to.equal("hour");
    });
  });

  describe("Mixed Projections", () => {
    it("should support both field lists and expressions in different projections", () => {
      createTestOlapTable<UserEvent>("Events5", {
        engine: ClickHouseEngines.MergeTree,
        orderByFields: ["timestamp"],
        projections: [
          {
            name: "by_user",
            select: ["userId", "timestamp"],
            orderBy: ["userId"],
          },
          {
            name: "hourly_agg",
            select: "toStartOfHour(timestamp) as hour, count() as cnt",
            orderBy: "hour",
            groupBy: "hour",
          },
        ],
      });

      const tables = getMooseInternal().tables;
      const registeredTable = tables.get("Events5");

      expect(registeredTable!.config.projections).to.have.lengthOf(2);

      // First projection uses arrays
      expect(registeredTable!.config.projections![0].select).to.be.an("array");

      // Second projection uses expressions
      expect(registeredTable!.config.projections![1].select).to.be.a("string");
      expect(registeredTable!.config.projections![1].groupBy).to.exist;
    });
  });

  describe("Empty Projections", () => {
    it("should handle tables without projections", () => {
      createTestOlapTable<UserEvent>("Events6", {
        engine: ClickHouseEngines.MergeTree,
        orderByFields: ["timestamp"],
      });

      const tables = getMooseInternal().tables;
      const registeredTable = tables.get("Events6");

      expect(registeredTable!.config.projections).to.be.undefined;
    });
  });

  describe("Projection Serialization", () => {
    it("should serialize projections to infrastructure map with camelCase for Rust serde", () => {
      createTestOlapTable<UserEvent>("Events7", {
        engine: ClickHouseEngines.MergeTree,
        orderByFields: ["timestamp"],
        projections: [
          {
            name: "by_user",
            select: ["userId", "timestamp"],
            orderBy: ["userId"],
          },
          {
            name: "hourly_agg",
            select: "toStartOfHour(timestamp) as hour, count() as cnt",
            groupBy: "hour",
          },
        ],
      });

      const infraMap = toInfraMap(getMooseInternal());
      const serializedTable = infraMap.tables["Events7"];

      expect(serializedTable.projections).to.have.lengthOf(2);

      // Verify non-aggregate projection has orderBy (camelCase for Rust serde)
      expect(serializedTable.projections![0]).to.deep.include({
        name: "by_user",
        orderBy: ["userId"],
      });
      expect(serializedTable.projections![0]).to.not.have.property("groupBy");

      // Verify aggregate projection has groupBy (camelCase for Rust serde)
      expect(serializedTable.projections![1]).to.deep.include({
        name: "hourly_agg",
        groupBy: "hour",
      });
      expect(serializedTable.projections![1]).to.not.have.property("orderBy");
    });
  });
});
