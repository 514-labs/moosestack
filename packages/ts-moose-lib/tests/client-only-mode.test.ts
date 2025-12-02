/**
 * Test suite for MOOSE_CLIENT_ONLY mode
 *
 * When MOOSE_CLIENT_ONLY=true, resource registration should be permissive:
 * - Duplicate registrations silently overwrite instead of throwing
 * - This enables Next.js HMR to re-execute modules without errors
 * - Applies to OlapTable, SqlResource (View, MaterializedView), and other resources
 */

import { expect } from "chai";
import {
  OlapTable,
  getTables,
  SqlResource,
  getSqlResources,
} from "../src/dmv2/index";
import { getMooseInternal, isClientOnlyMode } from "../src/dmv2/internal";

describe("Client-Only Mode", () => {
  beforeEach(() => {
    // Clear the registry before each test
    const registry = getMooseInternal();
    registry.tables.clear();
    registry.sqlResources.clear();
  });

  describe("isClientOnlyMode flag", () => {
    it("should reflect MOOSE_CLIENT_ONLY environment variable", () => {
      // The flag is set at module load time, so we can only test its current value
      const expectedValue = process.env.MOOSE_CLIENT_ONLY === "true";
      expect(isClientOnlyMode).to.equal(expectedValue);
    });
  });

  describe("when MOOSE_CLIENT_ONLY is not set (default behavior)", () => {
    before(() => {
      // Store original value
      (global as any).__originalClientOnly = process.env.MOOSE_CLIENT_ONLY;
      delete process.env.MOOSE_CLIENT_ONLY;
    });

    after(() => {
      // Restore original value
      if ((global as any).__originalClientOnly !== undefined) {
        process.env.MOOSE_CLIENT_ONLY = (global as any).__originalClientOnly;
      }
    });

    it("should throw error on duplicate table registration", () => {
      // Skip this test if we're running in client-only mode
      // (the flag is determined at module load time)
      if (isClientOnlyMode) {
        return;
      }

      interface TestData {
        id: string;
        value: number;
      }

      // First registration should succeed
      new OlapTable<TestData>("DuplicateTable", {
        orderByFields: ["id"],
      });

      // Second registration should throw
      expect(() => {
        new OlapTable<TestData>("DuplicateTable", {
          orderByFields: ["id"],
        });
      }).to.throw(
        "OlapTable with name DuplicateTable and version unversioned already exists",
      );
    });

    it("should throw error on duplicate versioned table registration", () => {
      // Skip this test if we're running in client-only mode
      if (isClientOnlyMode) {
        return;
      }

      interface TestData {
        id: string;
        value: number;
      }

      // First registration should succeed
      new OlapTable<TestData>("VersionedTable", {
        orderByFields: ["id"],
        version: "1.0",
      });

      // Second registration with same version should throw
      expect(() => {
        new OlapTable<TestData>("VersionedTable", {
          orderByFields: ["id"],
          version: "1.0",
        });
      }).to.throw(
        "OlapTable with name VersionedTable and version 1.0 already exists",
      );
    });

    it("should throw error on duplicate SqlResource registration", () => {
      // Skip this test if we're running in client-only mode
      if (isClientOnlyMode) {
        return;
      }

      // First registration should succeed
      new SqlResource(
        "DuplicateSqlResource",
        ["CREATE VIEW test AS SELECT 1"],
        ["DROP VIEW test"],
      );

      // Second registration should throw
      expect(() => {
        new SqlResource(
          "DuplicateSqlResource",
          ["CREATE VIEW test AS SELECT 1"],
          ["DROP VIEW test"],
        );
      }).to.throw("SqlResource with name DuplicateSqlResource already exists");
    });
  });

  describe("when MOOSE_CLIENT_ONLY=true (permissive mode)", () => {
    it("should allow duplicate table registration without throwing", () => {
      // This test only passes when isClientOnlyMode is true
      // To properly test, run with: MOOSE_CLIENT_ONLY=true pnpm test
      if (!isClientOnlyMode) {
        // Just verify the normal behavior works
        interface TestData {
          id: string;
        }

        const table1 = new OlapTable<TestData>("ClientOnlyTable", {
          orderByFields: ["id"],
        });

        expect(getTables().get("ClientOnlyTable")).to.equal(table1);
        return;
      }

      interface TestData {
        id: string;
        value: number;
      }

      // First registration
      const table1 = new OlapTable<TestData>("ClientOnlyDupeTable", {
        orderByFields: ["id"],
      });

      // Second registration should NOT throw in client-only mode
      const table2 = new OlapTable<TestData>("ClientOnlyDupeTable", {
        orderByFields: ["id"],
      });

      // Registry should have the second table (overwrite)
      const tables = getTables();
      expect(tables.size).to.equal(1);
      expect(tables.get("ClientOnlyDupeTable")).to.equal(table2);
      expect(tables.get("ClientOnlyDupeTable")).to.not.equal(table1);
    });

    it("should still support getTables introspection", () => {
      interface TestData {
        id: string;
      }

      new OlapTable<TestData>("IntrospectionTable1", {
        orderByFields: ["id"],
      });
      new OlapTable<TestData>("IntrospectionTable2", {
        orderByFields: ["id"],
      });

      const tables = getTables();
      expect(tables.size).to.equal(2);
      expect(tables.has("IntrospectionTable1")).to.be.true;
      expect(tables.has("IntrospectionTable2")).to.be.true;
    });

    it("should allow duplicate SqlResource registration without throwing", () => {
      // This test only passes when isClientOnlyMode is true
      // To properly test, run with: MOOSE_CLIENT_ONLY=true pnpm test
      if (!isClientOnlyMode) {
        // Just verify the normal behavior works
        const resource1 = new SqlResource(
          "ClientOnlySqlResource",
          ["CREATE VIEW test AS SELECT 1"],
          ["DROP VIEW test"],
        );

        expect(getSqlResources().get("ClientOnlySqlResource")).to.equal(
          resource1,
        );
        return;
      }

      // First registration
      const resource1 = new SqlResource(
        "ClientOnlyDupeSqlResource",
        ["CREATE VIEW test AS SELECT 1"],
        ["DROP VIEW test"],
      );

      // Second registration should NOT throw in client-only mode
      const resource2 = new SqlResource(
        "ClientOnlyDupeSqlResource",
        ["CREATE VIEW test2 AS SELECT 2"],
        ["DROP VIEW test2"],
      );

      // Registry should have the second resource (overwrite)
      const resources = getSqlResources();
      expect(resources.size).to.equal(1);
      expect(resources.get("ClientOnlyDupeSqlResource")).to.equal(resource2);
      expect(resources.get("ClientOnlyDupeSqlResource")).to.not.equal(
        resource1,
      );
    });

    it("should still support getSqlResources introspection", () => {
      new SqlResource(
        "IntrospectionResource1",
        ["CREATE VIEW r1 AS SELECT 1"],
        ["DROP VIEW r1"],
      );
      new SqlResource(
        "IntrospectionResource2",
        ["CREATE VIEW r2 AS SELECT 2"],
        ["DROP VIEW r2"],
      );

      const resources = getSqlResources();
      expect(resources.size).to.equal(2);
      expect(resources.has("IntrospectionResource1")).to.be.true;
      expect(resources.has("IntrospectionResource2")).to.be.true;
    });
  });
});
