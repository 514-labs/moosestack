import { expect } from "chai";
import { OlapTable, ClickHouseEngines } from "../src/index";
import { IJsonSchemaCollection } from "typia/src/schemas/json/IJsonSchemaCollection";
import { Column } from "../src/dataModels/dataModelTypes";

interface TestModel {
  id: string;
  value: number;
}

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
  }));

// Helper function to create OlapTable with mock schema for testing
const createTestOlapTable = <T>(name: string, config: any) => {
  return new OlapTable<T>(
    name,
    config,
    createMockSchema(),
    createMockColumns(["id", "value"]),
  );
};

describe("OlapTable Cluster Validation", () => {
  it("should allow cluster without explicit replication params", () => {
    expect(() => {
      createTestOlapTable<TestModel>("TestClusterOnly", {
        engine: ClickHouseEngines.ReplicatedMergeTree,
        orderByFields: ["id"],
        cluster: "test_cluster",
      });
    }).to.not.throw();
  });

  it("should allow explicit keeperPath and replicaName without cluster", () => {
    expect(() => {
      createTestOlapTable<TestModel>("TestExplicitOnly", {
        engine: ClickHouseEngines.ReplicatedMergeTree,
        orderByFields: ["id"],
        keeperPath: "/clickhouse/tables/{database}/{table}",
        replicaName: "{replica}",
      });
    }).to.not.throw();
  });

  it("should throw error when both cluster and keeperPath are specified", () => {
    expect(() => {
      createTestOlapTable<TestModel>("TestBothClusterAndKeeper", {
        engine: ClickHouseEngines.ReplicatedMergeTree,
        orderByFields: ["id"],
        cluster: "test_cluster",
        keeperPath: "/clickhouse/tables/{database}/{table}",
      });
    }).to.throw(
      /Cannot specify both 'cluster' and explicit replication params/,
    );
  });

  it("should throw error when both cluster and replicaName are specified", () => {
    expect(() => {
      createTestOlapTable<TestModel>("TestBothClusterAndReplica", {
        engine: ClickHouseEngines.ReplicatedMergeTree,
        orderByFields: ["id"],
        cluster: "test_cluster",
        replicaName: "{replica}",
      });
    }).to.throw(
      /Cannot specify both 'cluster' and explicit replication params/,
    );
  });

  it("should throw error when cluster, keeperPath, and replicaName are all specified", () => {
    expect(() => {
      createTestOlapTable<TestModel>("TestAll", {
        engine: ClickHouseEngines.ReplicatedMergeTree,
        orderByFields: ["id"],
        cluster: "test_cluster",
        keeperPath: "/clickhouse/tables/{database}/{table}",
        replicaName: "{replica}",
      });
    }).to.throw(
      /Cannot specify both 'cluster' and explicit replication params/,
    );
  });

  it("should allow non-replicated engines with cluster", () => {
    expect(() => {
      createTestOlapTable<TestModel>("TestMergeTreeWithCluster", {
        engine: ClickHouseEngines.MergeTree,
        orderByFields: ["id"],
        cluster: "test_cluster",
      });
    }).to.not.throw();
  });

  it("should allow ReplicatedMergeTree without cluster or explicit params (ClickHouse Cloud mode)", () => {
    expect(() => {
      createTestOlapTable<TestModel>("TestCloudMode", {
        engine: ClickHouseEngines.ReplicatedMergeTree,
        orderByFields: ["id"],
        // No cluster, no keeperPath, no replicaName
      });
    }).to.not.throw();
  });
});
