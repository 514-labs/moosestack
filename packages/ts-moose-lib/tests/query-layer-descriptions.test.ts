import { describe, it } from "mocha";
import { expect } from "chai";
import { createModelTool } from "../src/query-layer/model-tools";
import type { QueryModelBase } from "../src/query-layer/model-tools";
import { sql } from "../src/sqlHelpers";

function mockModel(overrides: Partial<QueryModelBase> = {}): QueryModelBase {
  return {
    defaults: {},
    filters: {},
    sortable: [],
    columnNames: [],
    toSql: () => sql`SELECT 1`,
    ...overrides,
  };
}

describe("description propagation into MCP tool schemas", () => {
  it("should propagate dimension descriptions into the dimensions schema", () => {
    const model = mockModel({
      dimensions: {
        status: { description: "Order status" },
        region: { description: "Geographic region" },
      },
    });

    const { schema } = createModelTool(model);
    const desc = schema.dimensions?.description;

    expect(desc).to.exist;
    expect(desc).to.include("status");
    expect(desc).to.include("Order status");
    expect(desc).to.include("region");
    expect(desc).to.include("Geographic region");
  });

  it("should propagate metric descriptions into the metrics schema", () => {
    const model = mockModel({
      metrics: {
        revenue: { description: "Total revenue from completed events" },
        totalEvents: { description: "Count of all events" },
      },
    });

    const { schema } = createModelTool(model);
    const desc = schema.metrics?.description;

    expect(desc).to.exist;
    expect(desc).to.include("revenue");
    expect(desc).to.include("Total revenue from completed events");
    expect(desc).to.include("totalEvents");
    expect(desc).to.include("Count of all events");
  });

  it("should propagate filter descriptions into filter param schemas", () => {
    const model = mockModel({
      filters: {
        status: {
          operators: ["eq", "in"] as const,
          inputType: "text" as const,
          description: "Filter by order status",
        },
      },
    });

    const { schema } = createModelTool(model);
    // "eq" operator maps to the snake_case filter name
    const eqDesc = schema.status?.description;
    // "in" operator maps to filter_name_in
    const inDesc = schema.status_in?.description;

    expect(eqDesc).to.equal("Filter by order status");
    expect(inDesc).to.equal("Filter by order status");
  });

  it("should handle dimensions without descriptions gracefully", () => {
    const model = mockModel({
      dimensions: {
        status: {},
      },
    });

    const { schema } = createModelTool(model);
    expect(schema.dimensions).to.exist;
  });

  it("should handle model with no dimensions or metrics", () => {
    const model = mockModel({});

    const { schema } = createModelTool(model);
    expect(schema.dimensions).to.not.exist;
    expect(schema.metrics).to.not.exist;
  });
});
