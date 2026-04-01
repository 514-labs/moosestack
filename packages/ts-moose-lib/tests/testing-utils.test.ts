import { expect } from "chai";

import { percentile } from "../src/testing/clickhouse-diagnostics";

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
});
