/**
 * Tests for MaterializedView lifeCycle serialization behavior.
 */

import { expect } from "chai";
import { MaterializedView } from "../src/dmv2/sdk/materializedView";
import { OlapTable } from "../src/dmv2/sdk/olapTable";
import { LifeCycle } from "../src/dmv2/sdk/lifeCycle";
import { getMooseInternal, toInfraMap } from "../src/dmv2/internal";
import { Column } from "../src/dataModels/dataModelTypes";
import { IJsonSchemaCollection } from "typia/src/schemas/json/IJsonSchemaCollection";

interface TestData {
  id: string;
  value: number;
}

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

describe("MaterializedView lifeCycle serialization", () => {
  beforeEach(() => {
    const registry = getMooseInternal();
    registry.tables.clear();
    registry.materializedViews.clear();
  });

  it("should serialize DELETION_PROTECTED lifeCycle to infra map", () => {
    new MaterializedView<TestData>(
      {
        selectStatement: "SELECT id, value FROM source_table",
        selectTables: [],
        targetTable: { name: "target_table" },
        materializedViewName: "test_mv",
        lifeCycle: LifeCycle.DELETION_PROTECTED,
      },
      createMockSchema(),
      createMockColumns(["id", "value"]),
    );

    const infraMap = toInfraMap(getMooseInternal());
    expect(infraMap.materializedViews["test_mv"].lifeCycle).to.equal(
      LifeCycle.DELETION_PROTECTED,
    );
  });

  it("should serialize EXTERNALLY_MANAGED lifeCycle to infra map", () => {
    new MaterializedView<TestData>(
      {
        selectStatement: "SELECT id, value FROM source_table",
        selectTables: [],
        targetTable: { name: "target_table_ext" },
        materializedViewName: "external_mv",
        lifeCycle: LifeCycle.EXTERNALLY_MANAGED,
      },
      createMockSchema(),
      createMockColumns(["id", "value"]),
    );

    const infraMap = toInfraMap(getMooseInternal());
    expect(infraMap.materializedViews["external_mv"].lifeCycle).to.equal(
      LifeCycle.EXTERNALLY_MANAGED,
    );
  });

  it("should omit lifeCycle from infra map when not specified", () => {
    new MaterializedView<TestData>(
      {
        selectStatement: "SELECT id, value FROM source_table",
        selectTables: [],
        targetTable: { name: "target_table_default" },
        materializedViewName: "default_mv",
      },
      createMockSchema(),
      createMockColumns(["id", "value"]),
    );

    const infraMap = toInfraMap(getMooseInternal());
    expect(infraMap.materializedViews["default_mv"].lifeCycle).to.be.undefined;
  });
});
