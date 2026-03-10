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
    const base = new View("base_view", "SELECT 1", []);
    const derived = new View("derived_view", "SELECT * FROM base_view", [base]);
    expect(derived.sourceTables).to.include("`base_view`");
  });

  it("uses database-qualified reference for View with database", () => {
    const base = new View("base_view", "SELECT 1", [], {
      database: "analytics",
    });
    const derived = new View(
      "derived_view",
      "SELECT * FROM analytics.base_view",
      [base],
    );
    expect(derived.sourceTables).to.include("`analytics`.`base_view`");
  });

  it("uses plain backtick reference for OlapTable without database", () => {
    const table = new OlapTable<{ id: string }>("events");
    const view = new View("v", "SELECT * FROM events", [table]);
    expect(view.sourceTables).to.include("`events`");
  });

  it("uses database-qualified reference for OlapTable with database", () => {
    const table = new OlapTable<{ id: string }>("events", { database: "raw" });
    const view = new View("v2", "SELECT * FROM raw.events", [table]);
    expect(view.sourceTables).to.include("`raw`.`events`");
  });
});

// ---------------------------------------------------------------------------
// View construction
// ---------------------------------------------------------------------------

describe("View — construction", () => {
  it("creates a View without config (backward compat)", () => {
    const view = new View("my_view", "SELECT 1", []);
    expect(view.name).to.equal("my_view");
    expect(view.database).to.be.undefined;
    expect(view.selectSql).to.equal("SELECT 1");
  });

  it("creates a View with database in config", () => {
    const view = new View("my_view", "SELECT 1", [], { database: "prod_db" });
    expect(view.database).to.equal("prod_db");
    expect(view.name).to.equal("my_view");
  });

  it("throws when a duplicate view name is registered", () => {
    new View("dup_view", "SELECT 1", []);
    expect(() => new View("dup_view", "SELECT 2", [])).to.throw(
      /already exists/,
    );
  });
});

// ---------------------------------------------------------------------------
// Serialization via toInfraMap
// ---------------------------------------------------------------------------

describe("View — serialization", () => {
  it("omits database in ViewJson when not set", () => {
    new View("ser_no_db", "SELECT 1", []);
    const infra = toInfraMap(getMooseInternal());
    const viewJson = infra.views["ser_no_db"];
    expect(viewJson).to.exist;
    expect(viewJson).to.not.have.property("database");
  });

  it("includes database in ViewJson when set via config", () => {
    new View("ser_with_db", "SELECT 1", [], { database: "analytics" });
    const infra = toInfraMap(getMooseInternal());
    const viewJson = infra.views["ser_with_db"];
    expect(viewJson).to.exist;
    expect(viewJson.database).to.equal("analytics");
  });

  it("serializes selectSql and sourceTables correctly", () => {
    const base = new View("base_ser", "SELECT 1", [], { database: "src_db" });
    new View("derived_ser", "SELECT * FROM src_db.base_ser", [base]);
    const infra = toInfraMap(getMooseInternal());
    const derived = infra.views["derived_ser"];
    expect(derived.selectSql).to.equal("SELECT * FROM src_db.base_ser");
    expect(derived.sourceTables).to.include("`src_db`.`base_ser`");
  });
});
