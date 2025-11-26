/**
 * Tests for OlapTable versioning functionality.
 *
 * This test module verifies that multiple versions of OlapTables with the same name
 * can coexist and that the infrastructure map generation handles versioned keys correctly.
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
    annotations: [],
  }));

// Helper function to create OlapTable with mock schema for testing
const createTestOlapTable = <T>(
  name: string,
  config: any,
  fields: string[] = ["userId", "eventType", "timestamp", "metadata"],
) => {
  return new OlapTable<T>(
    name,
    config,
    createMockSchema(),
    createMockColumns(fields),
  );
};

// Test data models
interface UserEvent {
  userId: Key<string>;
  eventType: string;
  timestamp: number;
  metadata?: string;
}

interface UserEventV2 {
  userId: Key<string>;
  eventType: string;
  timestamp: number;
  metadata?: string;
  sessionId: string;
  userAgent?: string;
}

describe("OlapTable Versioning", () => {
  beforeEach(() => {
    // Clear registries before each test
    getMooseInternal().tables.clear();
  });

  describe("Multiple Table Versions", () => {
    it("should allow multiple versions of the same table to coexist", () => {
      // Create version 1.0 of the table
      const tableV1 = createTestOlapTable<UserEvent>("UserEvents", {
        version: "1.0",
        engine: ClickHouseEngines.MergeTree,
        orderByFields: ["userId", "timestamp"],
      });

      // Create version 2.0 of the table with different configuration
      const tableV2 = createTestOlapTable<UserEventV2>(
        "UserEvents",
        {
          version: "2.0",
          engine: ClickHouseEngines.ReplacingMergeTree,
          orderByFields: ["userId", "sessionId", "timestamp"],
        },
        [
          "userId",
          "eventType",
          "timestamp",
          "metadata",
          "sessionId",
          "userAgent",
        ],
      );

      // Both tables should be registered successfully
      const tables = getMooseInternal().tables;
      expect(tables.has("UserEvents_1.0")).to.be.true;
      expect(tables.has("UserEvents_2.0")).to.be.true;

      // Verify they are different instances
      expect(tables.get("UserEvents_1.0")).to.equal(tableV1);
      expect(tables.get("UserEvents_2.0")).to.equal(tableV2);

      // Verify configurations are different
      expect(tableV1.config.version).to.equal("1.0");
      expect(tableV2.config.version).to.equal("2.0");
      expect((tableV1.config as any).engine).to.equal(
        ClickHouseEngines.MergeTree,
      );
      expect((tableV2.config as any).engine).to.equal(
        ClickHouseEngines.ReplacingMergeTree,
      );
    });

    it("should allow unversioned and versioned tables with the same name to coexist", () => {
      // Create unversioned table
      const unversionedTable = createTestOlapTable<UserEvent>("EventData", {
        engine: ClickHouseEngines.MergeTree,
        orderByFields: ["userId"],
      });

      // Create versioned table with same name
      const versionedTable = createTestOlapTable<UserEvent>("EventData", {
        version: "1.5",
        engine: ClickHouseEngines.MergeTree,
        orderByFields: ["userId"],
      });

      // Both should be registered
      const tables = getMooseInternal().tables;
      expect(tables.has("EventData")).to.be.true; // Unversioned
      expect(tables.has("EventData_1.5")).to.be.true; // Versioned

      expect(tables.get("EventData")).to.equal(unversionedTable);
      expect(tables.get("EventData_1.5")).to.equal(versionedTable);
    });

    it("should prevent duplicate version registration", () => {
      // Create first table
      createTestOlapTable<UserEvent>("DuplicateTest", {
        version: "1.0",
        engine: ClickHouseEngines.MergeTree,
        orderByFields: ["userId"],
      });

      // Attempting to create another table with same name and version should fail
      expect(() => {
        createTestOlapTable<UserEvent>("DuplicateTest", {
          version: "1.0",
          engine: ClickHouseEngines.MergeTree,
          orderByFields: ["userId"],
        });
      }).to.throw(
        "OlapTable with name DuplicateTest and version 1.0 already exists",
      );
    });
  });

  describe("Infrastructure Map Generation", () => {
    it("should use versioned keys in infrastructure map", () => {
      // Create multiple versions of tables
      const tableV1 = createTestOlapTable<UserEvent>("InfraMapTest", {
        version: "1.0",
        engine: ClickHouseEngines.MergeTree,
        orderByFields: ["userId"],
      });

      const tableV2 = createTestOlapTable<UserEvent>("InfraMapTest", {
        version: "2.0",
        engine: ClickHouseEngines.ReplacingMergeTree,
        orderByFields: ["userId", "timestamp"],
      });

      const unversionedTable = createTestOlapTable<UserEvent>(
        "UnversionedInfraTest",
        {
          engine: ClickHouseEngines.MergeTree,
          orderByFields: ["userId"],
        },
      );

      // Generate infrastructure map
      const infraMap = toInfraMap(getMooseInternal());

      // Verify versioned keys are used in infrastructure map
      expect(infraMap.tables).to.have.property("InfraMapTest_1.0");
      expect(infraMap.tables).to.have.property("InfraMapTest_2.0");
      expect(infraMap.tables).to.have.property("UnversionedInfraTest");

      // Verify table configurations in infra map
      const v1Config = infraMap.tables["InfraMapTest_1.0"];
      const v2Config = infraMap.tables["InfraMapTest_2.0"];
      const unversionedConfig = infraMap.tables["UnversionedInfraTest"];

      expect(v1Config.name).to.equal("InfraMapTest");
      expect(v1Config.version).to.equal("1.0");
      expect(v1Config.engineConfig?.engine).to.equal("MergeTree");

      expect(v2Config.name).to.equal("InfraMapTest");
      expect(v2Config.version).to.equal("2.0");
      expect(v2Config.engineConfig?.engine).to.equal("ReplacingMergeTree");

      expect(unversionedConfig.name).to.equal("UnversionedInfraTest");
      expect(unversionedConfig.version).to.be.undefined;
    });

    it("should handle semantic versions with dots correctly", () => {
      // Create table with semantic version
      const table = createTestOlapTable<UserEvent>("SemanticVersionTest", {
        version: "1.2.3",
        engine: ClickHouseEngines.MergeTree,
        orderByFields: ["userId"],
      });

      // Should be registered with version in key
      const tables = getMooseInternal().tables;
      expect(tables.has("SemanticVersionTest_1.2.3")).to.be.true;
      expect(tables.get("SemanticVersionTest_1.2.3")).to.equal(table);

      // Verify in infrastructure map
      const infraMap = toInfraMap(getMooseInternal());
      expect(infraMap.tables).to.have.property("SemanticVersionTest_1.2.3");

      const tableConfig = infraMap.tables["SemanticVersionTest_1.2.3"];
      expect(tableConfig.version).to.equal("1.2.3");
    });
  });

  describe("Table Name Generation", () => {
    it("should generate correct versioned table names", () => {
      const table = createTestOlapTable<UserEvent>("TestTable", {
        version: "2.1.0",
        engine: ClickHouseEngines.MergeTree,
        orderByFields: ["userId"],
      });

      // The generateTableName method should handle version correctly
      // Note: This tests the internal table name generation logic
      const infraMap = toInfraMap(getMooseInternal());
      const tableConfig = infraMap.tables["TestTable_2.1.0"];

      expect(tableConfig.name).to.equal("TestTable");
      expect(tableConfig.version).to.equal("2.1.0");
    });

    it("should handle unversioned tables correctly", () => {
      const table = createTestOlapTable<UserEvent>("UnversionedTable", {
        engine: ClickHouseEngines.MergeTree,
        orderByFields: ["userId"],
      });

      const infraMap = toInfraMap(getMooseInternal());
      const tableConfig = infraMap.tables["UnversionedTable"];

      expect(tableConfig.name).to.equal("UnversionedTable");
      expect(tableConfig.version).to.be.undefined;
    });
  });

  describe("Blue/Green Migration Support", () => {
    it("should support blue/green migration scenario", () => {
      // Simulate a blue/green migration scenario
      // Old version (blue) - existing production table
      const blueTable = createTestOlapTable<UserEvent>("UserActivity", {
        version: "1.0",
        engine: ClickHouseEngines.MergeTree,
        orderByFields: ["userId", "timestamp"],
      });

      // New version (green) - updated table with different engine
      const greenTable = createTestOlapTable<UserEventV2>(
        "UserActivity",
        {
          version: "2.0",
          engine: ClickHouseEngines.ReplacingMergeTree,
          orderByFields: ["userId", "sessionId", "timestamp"],
        },
        [
          "userId",
          "eventType",
          "timestamp",
          "metadata",
          "sessionId",
          "userAgent",
        ],
      );

      // Both versions should coexist
      const tables = getMooseInternal().tables;
      expect(tables.has("UserActivity_1.0")).to.be.true;
      expect(tables.has("UserActivity_2.0")).to.be.true;

      // Infrastructure map should contain both versions
      const infraMap = toInfraMap(getMooseInternal());
      expect(infraMap.tables).to.have.property("UserActivity_1.0");
      expect(infraMap.tables).to.have.property("UserActivity_2.0");

      // Verify different configurations
      const blueConfig = infraMap.tables["UserActivity_1.0"];
      const greenConfig = infraMap.tables["UserActivity_2.0"];

      expect(blueConfig.engineConfig?.engine).to.equal("MergeTree");
      expect(greenConfig.engineConfig?.engine).to.equal("ReplacingMergeTree");

      expect(blueConfig.orderBy).to.deep.equal(["userId", "timestamp"]);
      expect(greenConfig.orderBy).to.deep.equal([
        "userId",
        "sessionId",
        "timestamp",
      ]);
    });
  });
});
