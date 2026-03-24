import { expect } from "chai";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";

import { percentile } from "../src/testing/clickhouse-diagnostics";
import {
  hashResultSet,
  saveSnapshot,
  compareSnapshot,
} from "../src/testing/snapshot";

describe("testing utilities", () => {
  // ---------------------------------------------------------------------------
  // percentile
  // ---------------------------------------------------------------------------
  describe("percentile", () => {
    it("returns 0 for empty array", () => {
      expect(percentile([], 50)).to.equal(0);
    });

    it("returns the single element for a 1-element array", () => {
      expect(percentile([42], 50)).to.equal(42);
      expect(percentile([42], 95)).to.equal(42);
    });

    it("calculates p50 correctly", () => {
      const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      const result = percentile(values, 50);
      expect(result).to.equal(50);
    });

    it("calculates p95 correctly", () => {
      const values = Array.from({ length: 100 }, (_, i) => i + 1);
      const result = percentile(values, 95);
      expect(result).to.equal(95);
    });

    it("does not mutate the input array", () => {
      const values = [5, 3, 1, 4, 2];
      const copy = [...values];
      percentile(values, 50);
      expect(values).to.deep.equal(copy);
    });

    it("handles unsorted input", () => {
      const values = [100, 1, 50, 25, 75];
      expect(percentile(values, 50)).to.equal(50);
    });
  });

  // ---------------------------------------------------------------------------
  // hashResultSet
  // ---------------------------------------------------------------------------
  describe("hashResultSet", () => {
    it("returns same hash regardless of row order", () => {
      const rows1 = [
        { a: 1, b: 2 },
        { a: 3, b: 4 },
      ];
      const rows2 = [
        { a: 3, b: 4 },
        { a: 1, b: 2 },
      ];
      expect(hashResultSet(rows1)).to.equal(hashResultSet(rows2));
    });

    it("returns same hash regardless of key order", () => {
      const rows1 = [{ a: 1, b: 2 }];
      const rows2 = [{ b: 2, a: 1 }];
      expect(hashResultSet(rows1)).to.equal(hashResultSet(rows2));
    });

    it("sorts nested object keys", () => {
      const rows1 = [{ outer: { z: 1, a: 2 } }];
      const rows2 = [{ outer: { a: 2, z: 1 } }];
      expect(hashResultSet(rows1)).to.equal(hashResultSet(rows2));
    });

    it("returns different hash for different data", () => {
      const rows1 = [{ a: 1 }];
      const rows2 = [{ a: 2 }];
      expect(hashResultSet(rows1)).to.not.equal(hashResultSet(rows2));
    });

    it("returns a hex sha256 string", () => {
      const hash = hashResultSet([{ x: 1 }]);
      expect(hash).to.match(/^[0-9a-f]{64}$/);
    });

    it("handles empty rows", () => {
      const hash = hashResultSet([]);
      expect(hash).to.match(/^[0-9a-f]{64}$/);
    });
  });

  // ---------------------------------------------------------------------------
  // saveSnapshot / compareSnapshot
  // ---------------------------------------------------------------------------
  describe("saveSnapshot / compareSnapshot", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(join(tmpdir(), "moose-snapshot-test-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("saves and compares a matching snapshot", async () => {
      const rows = [
        { id: 1, name: "test" },
        { id: 2, name: "other" },
      ];
      const filepath = await saveSnapshot("test-snap", rows, tempDir);

      expect(filepath).to.include("test-snap.json");

      const comparison = await compareSnapshot("test-snap", rows, tempDir);
      expect(comparison.match).to.be.true;
      expect(comparison.expectedRowCount).to.equal(2);
      expect(comparison.actualRowCount).to.equal(2);
      expect(comparison.expectedHash).to.equal(comparison.actualHash);
    });

    it("detects a mismatch when data changes", async () => {
      const original = [{ id: 1, value: 100 }];
      await saveSnapshot("mismatch-test", original, tempDir);

      const changed = [{ id: 1, value: 999 }];
      const comparison = await compareSnapshot(
        "mismatch-test",
        changed,
        tempDir,
      );
      expect(comparison.match).to.be.false;
      expect(comparison.expectedHash).to.not.equal(comparison.actualHash);
    });

    it("detects row count changes", async () => {
      const original = [{ a: 1 }, { a: 2 }];
      await saveSnapshot("count-test", original, tempDir);

      const fewer = [{ a: 1 }];
      const comparison = await compareSnapshot("count-test", fewer, tempDir);
      expect(comparison.match).to.be.false;
      expect(comparison.expectedRowCount).to.equal(2);
      expect(comparison.actualRowCount).to.equal(1);
    });

    it("throws descriptive error for missing snapshot", async () => {
      try {
        await compareSnapshot("nonexistent", [], tempDir);
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.message).to.include("Snapshot file not found");
        expect(err.message).to.include("nonexistent");
      }
    });

    it("throws descriptive error for corrupted snapshot", async () => {
      const { writeFile: wf } = await import("node:fs/promises");
      await wf(join(tempDir, "bad.json"), "not valid json {{{");
      try {
        await compareSnapshot("bad", [], tempDir);
        expect.fail("should have thrown");
      } catch (err: any) {
        expect(err.message).to.include("not valid JSON");
      }
    });

    it("saved snapshot file has expected structure", async () => {
      const rows = [{ x: 42 }];
      const filepath = await saveSnapshot("structure-test", rows, tempDir);
      const content = JSON.parse(await readFile(filepath, "utf-8"));

      expect(content).to.have.property("name", "structure-test");
      expect(content).to.have.property("savedAt");
      expect(content).to.have.property("rowCount", 1);
      expect(content)
        .to.have.property("hash")
        .that.matches(/^[0-9a-f]{64}$/);
      expect(content)
        .to.have.property("rows")
        .that.deep.equals([{ x: 42 }]);
    });
  });
});
