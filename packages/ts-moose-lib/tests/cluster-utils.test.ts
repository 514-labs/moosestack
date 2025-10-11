import { expect } from "chai";
import { Cluster } from "../src/cluster-utils";
import { availableParallelism } from "node:os";

describe("Cluster", () => {
  describe("computeCPUUsageCount", () => {
    it("should cap workers at maxWorkerCount even when ratio would give more", () => {
      const cluster = new Cluster({
        workerStart: async () => ({}),
        workerStop: async () => {},
      });

      const cpuCount = availableParallelism();
      const maxWorkers = 2;
      const ratio = 0.7; // Would give Math.floor(cpuCount * 0.7) workers

      const result = cluster.computeCPUUsageCount(ratio, maxWorkers);

      // Should be capped at maxWorkers, not the ratio-calculated value
      expect(result).to.equal(
        Math.min(maxWorkers, Math.max(1, Math.floor(cpuCount * ratio))),
      );
    });

    it("should ensure minimum of 1 worker even with low ratio", () => {
      const cluster = new Cluster({
        workerStart: async () => ({}),
        workerStop: async () => {},
      });

      // Very low ratio on even 1-core machine should still give 1 worker
      const result = cluster.computeCPUUsageCount(0.01, undefined);
      expect(result).to.equal(1);
    });

    it("should treat zero maxWorkerCount as undefined due to falsy check", () => {
      const cluster = new Cluster({
        workerStart: async () => ({}),
        workerStop: async () => {},
      });

      const cpuCount = availableParallelism();
      // 0 is falsy, so `0 || cpuCount` returns cpuCount
      const result = cluster.computeCPUUsageCount(0.7, 0);

      expect(result).to.equal(Math.max(1, Math.floor(cpuCount * 0.7)));
    });
  });

  describe("constructor validation", () => {
    it("should reject maxCpuUsageRatio > 1", () => {
      expect(() => {
        new Cluster({
          workerStart: async () => ({}),
          workerStop: async () => {},
          maxCpuUsageRatio: 1.5,
        });
      }).to.throw("maxCpuUsageRatio must be between 0 and 1");
    });

    it("should reject maxCpuUsageRatio < 0", () => {
      expect(() => {
        new Cluster({
          workerStart: async () => ({}),
          workerStop: async () => {},
          maxCpuUsageRatio: -0.1,
        });
      }).to.throw("maxCpuUsageRatio must be between 0 and 1");
    });

    it("should accept maxCpuUsageRatio = 0", () => {
      // Edge case: 0 is valid (though will always give 1 worker due to Math.max)
      expect(() => {
        new Cluster({
          workerStart: async () => ({}),
          workerStop: async () => {},
          maxCpuUsageRatio: 0,
        });
      }).to.not.throw();
    });
  });
});
