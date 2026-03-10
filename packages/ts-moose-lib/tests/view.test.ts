/**
 * Tests for the View class in dmv2/sdk/view.ts
 */

import { expect } from "chai";
import { View } from "../src/dmv2/sdk/view";
import { OlapTable } from "../src/dmv2";
import { getMooseInternal, toInfraMap } from "../src/dmv2/internal";

function clearRegistry() {
  const registry = getMooseInternal();
  registry.tables.clear();
  registry.views.clear();
  registry.materializedViews.clear();
}

beforeEach(() => {
  clearRegistry();
});

afterEach(() => {
  clearRegistry();
});

// ---------------------------------------------------------------------------
// formatTableReference (via source_tables inspection)
// ---------------------------------------------------------------------------

describe("View — formatTableReference", () => {
  it("uses plain backtick reference for View without database", () => {
    const base = new View("base_view", {
      selectStatement: "SELECT 1",
      baseTables: [],
    });
    const derived = new View("derived_view", {
      selectStatement: "SELECT * FROM base_view",
      baseTables: [base],
    });
    expect(derived.sourceTables).to.include("`base_view`");
  });

  it("uses database-qualified reference for View with database", () => {
    const base = new View("base_view", {
      selectStatement: "SELECT 1",
      baseTables: [],
      database: "analytics",
    });
    const derived = new View("derived_view", {
      selectStatement: "SELECT * FROM analytics.base_view",
      baseTables: [base],
    });
    expect(derived.sourceTables).to.include("`analytics`.`base_view`");
  });

  it("uses plain backtick reference for OlapTable without database", () => {
    const table = new OlapTable<{ id: string }>("events");
    const view = new View("v", {
      selectStatement: "SELECT * FROM events",
      baseTables: [table],
    });
    expect(view.sourceTables).to.include("`events`");
  });

  it("uses database-qualified reference for OlapTable with database", () => {
    const table = new OlapTable<{ id: string }>("events", { database: "raw" });
    const view = new View("v2", {
      selectStatement: "SELECT * FROM raw.events",
      baseTables: [table],
    });
    expect(view.sourceTables).to.include("`raw`.`events`");
  });
});

// ---------------------------------------------------------------------------
// View construction
// ---------------------------------------------------------------------------

describe("View — construction", () => {
  it("creates a View without database", () => {
    const view = new View("my_view", {
      selectStatement: "SELECT 1",
      baseTables: [],
    });
    expect(view.name).to.equal("my_view");
    expect(view.database).to.be.undefined;
    expect(view.selectSql).to.equal("SELECT 1");
  });

  it("creates a View with database in config", () => {
    const view = new View("my_view", {
      selectStatement: "SELECT 1",
      baseTables: [],
      database: "prod_db",
    });
    expect(view.database).to.equal("prod_db");
    expect(view.name).to.equal("my_view");
  });

  it("throws when a duplicate view name is registered", () => {
    new View("dup_view", { selectStatement: "SELECT 1", baseTables: [] });
    expect(
      () =>
        new View("dup_view", { selectStatement: "SELECT 2", baseTables: [] }),
    ).to.throw(/already exists/);
  });

  it("allows the same view name in different databases", () => {
    expect(() => {
      new View("dup_view", {
        selectStatement: "SELECT 1",
        baseTables: [],
        database: "raw",
      });
      new View("dup_view", {
        selectStatement: "SELECT 2",
        baseTables: [],
        database: "analytics",
      });
    }).to.not.throw();
  });
});

// ---------------------------------------------------------------------------
// Serialization via toInfraMap
// ---------------------------------------------------------------------------

describe("View — serialization", () => {
  it("omits database in ViewJson when not set", () => {
    new View("ser_no_db", { selectStatement: "SELECT 1", baseTables: [] });
    const infra = toInfraMap(getMooseInternal());
    const viewJson = infra.views["ser_no_db"];
    expect(viewJson).to.exist;
    expect(viewJson).to.not.have.property("database");
  });

  it("includes database in ViewJson when set via config", () => {
    new View("ser_with_db", {
      selectStatement: "SELECT 1",
      baseTables: [],
      database: "analytics",
    });
    const infra = toInfraMap(getMooseInternal());
    const viewJson = infra.views["analytics.ser_with_db"];
    expect(viewJson).to.exist;
    expect(viewJson.database).to.equal("analytics");
  });

  it("serializes selectSql and sourceTables correctly", () => {
    const base = new View("base_ser", {
      selectStatement: "SELECT 1",
      baseTables: [],
      database: "src_db",
    });
    new View("derived_ser", {
      selectStatement: "SELECT * FROM src_db.base_ser",
      baseTables: [base],
    });
    const infra = toInfraMap(getMooseInternal());
    const derived = infra.views["derived_ser"];
    expect(derived.selectSql).to.equal("SELECT * FROM src_db.base_ser");
    expect(derived.sourceTables).to.include("`src_db`.`base_ser`");
  });
});
