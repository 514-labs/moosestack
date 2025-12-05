import { expect } from "chai";
import { IngestPipeline } from "../src/dmv2/sdk/ingestPipeline";
import { LifeCycle } from "../src/dmv2/sdk/lifeCycle";
import { getMooseInternal } from "../src/dmv2/internal";

interface TestData {
  id: string;
  value: number;
}

describe("IngestPipeline", () => {
  beforeEach(() => {
    // Clear the registry before each test
    const registry = getMooseInternal();
    registry.tables.clear();
    registry.streams.clear();
    registry.ingestApis.clear();
  });

  describe("lifeCycle propagation", () => {
    it("should propagate top-level lifeCycle to table when table.lifeCycle is not specified", () => {
      const pipeline = new IngestPipeline<TestData>("TestPipeline", {
        table: {
          orderByFields: ["id"],
        },
        stream: false,
        ingestApi: false,
        lifeCycle: LifeCycle.EXTERNALLY_MANAGED,
      });

      expect(pipeline.table).to.not.be.undefined;
      expect(pipeline.table?.config.lifeCycle).to.equal(
        LifeCycle.EXTERNALLY_MANAGED,
      );
    });

    it("should propagate top-level lifeCycle to stream when stream.lifeCycle is not specified", () => {
      const pipeline = new IngestPipeline<TestData>("TestPipeline", {
        table: true,
        stream: {
          parallelism: 1,
        },
        ingestApi: false,
        lifeCycle: LifeCycle.DELETION_PROTECTED,
      });

      expect(pipeline.stream).to.not.be.undefined;
      expect(pipeline.stream?.config.lifeCycle).to.equal(
        LifeCycle.DELETION_PROTECTED,
      );
    });

    it("should propagate top-level lifeCycle to both table and stream", () => {
      const pipeline = new IngestPipeline<TestData>("TestPipeline", {
        table: {
          orderByFields: ["id"],
        },
        stream: {
          parallelism: 2,
        },
        ingestApi: false,
        lifeCycle: LifeCycle.FULLY_MANAGED,
      });

      expect(pipeline.table).to.not.be.undefined;
      expect(pipeline.table?.config.lifeCycle).to.equal(
        LifeCycle.FULLY_MANAGED,
      );
      expect(pipeline.stream).to.not.be.undefined;
      expect(pipeline.stream?.config.lifeCycle).to.equal(
        LifeCycle.FULLY_MANAGED,
      );
    });

    it("should respect table-specific lifeCycle over top-level lifeCycle", () => {
      const pipeline = new IngestPipeline<TestData>("TestPipeline", {
        table: {
          orderByFields: ["id"],
          lifeCycle: LifeCycle.DELETION_PROTECTED,
        },
        stream: false,
        ingestApi: false,
        lifeCycle: LifeCycle.EXTERNALLY_MANAGED,
      });

      expect(pipeline.table).to.not.be.undefined;
      expect(pipeline.table?.config.lifeCycle).to.equal(
        LifeCycle.DELETION_PROTECTED,
      );
    });

    it("should respect stream-specific lifeCycle over top-level lifeCycle", () => {
      const pipeline = new IngestPipeline<TestData>("TestPipeline", {
        table: true,
        stream: {
          parallelism: 1,
          lifeCycle: LifeCycle.FULLY_MANAGED,
        },
        ingestApi: false,
        lifeCycle: LifeCycle.EXTERNALLY_MANAGED,
      });

      expect(pipeline.stream).to.not.be.undefined;
      expect(pipeline.stream?.config.lifeCycle).to.equal(
        LifeCycle.FULLY_MANAGED,
      );
    });

    it("should allow different lifeCycles for table and stream with top-level default", () => {
      const pipeline = new IngestPipeline<TestData>("TestPipeline", {
        table: {
          orderByFields: ["id"],
          lifeCycle: LifeCycle.DELETION_PROTECTED,
        },
        stream: {
          parallelism: 1,
        },
        ingestApi: false,
        lifeCycle: LifeCycle.EXTERNALLY_MANAGED,
      });

      expect(pipeline.table).to.not.be.undefined;
      expect(pipeline.table?.config.lifeCycle).to.equal(
        LifeCycle.DELETION_PROTECTED,
      );
      expect(pipeline.stream).to.not.be.undefined;
      expect(pipeline.stream?.config.lifeCycle).to.equal(
        LifeCycle.EXTERNALLY_MANAGED,
      );
    });

    it("should work with table: true and propagate lifeCycle", () => {
      const pipeline = new IngestPipeline<TestData>("TestPipeline", {
        table: true,
        stream: false,
        ingestApi: false,
        lifeCycle: LifeCycle.DELETION_PROTECTED,
      });

      expect(pipeline.table).to.not.be.undefined;
      expect(pipeline.table?.config.lifeCycle).to.equal(
        LifeCycle.DELETION_PROTECTED,
      );
    });

    it("should work with stream: true and propagate lifeCycle", () => {
      const pipeline = new IngestPipeline<TestData>("TestPipeline", {
        table: true,
        stream: true,
        ingestApi: false,
        lifeCycle: LifeCycle.EXTERNALLY_MANAGED,
      });

      expect(pipeline.stream).to.not.be.undefined;
      expect(pipeline.stream?.config.lifeCycle).to.equal(
        LifeCycle.EXTERNALLY_MANAGED,
      );
    });

    it("should not set lifeCycle when not specified at any level", () => {
      const pipeline = new IngestPipeline<TestData>("TestPipeline", {
        table: {
          orderByFields: ["id"],
        },
        stream: {
          parallelism: 1,
        },
        ingestApi: false,
      });

      expect(pipeline.table).to.not.be.undefined;
      expect(pipeline.table?.config.lifeCycle).to.be.undefined;
      expect(pipeline.stream).to.not.be.undefined;
      expect(pipeline.stream?.config.lifeCycle).to.be.undefined;
    });

    it("should propagate top-level lifeCycle to deadLetterQueue when deadLetterQueue.lifeCycle is not specified", () => {
      const pipeline = new IngestPipeline<TestData>("TestPipeline", {
        table: true,
        stream: true,
        ingestApi: false,
        deadLetterQueue: {
          parallelism: 1,
        },
        lifeCycle: LifeCycle.DELETION_PROTECTED,
      });

      expect(pipeline.deadLetterQueue).to.not.be.undefined;
      expect(pipeline.deadLetterQueue?.config.lifeCycle).to.equal(
        LifeCycle.DELETION_PROTECTED,
      );
    });

    it("should propagate top-level lifeCycle to deadLetterQueue when deadLetterQueue is true", () => {
      const pipeline = new IngestPipeline<TestData>("TestPipeline", {
        table: true,
        stream: true,
        ingestApi: false,
        deadLetterQueue: true,
        lifeCycle: LifeCycle.EXTERNALLY_MANAGED,
      });

      expect(pipeline.deadLetterQueue).to.not.be.undefined;
      expect(pipeline.deadLetterQueue?.config.lifeCycle).to.equal(
        LifeCycle.EXTERNALLY_MANAGED,
      );
    });

    it("should respect deadLetterQueue-specific lifeCycle over top-level lifeCycle", () => {
      const pipeline = new IngestPipeline<TestData>("TestPipeline", {
        table: true,
        stream: true,
        ingestApi: false,
        deadLetterQueue: {
          parallelism: 2,
          lifeCycle: LifeCycle.FULLY_MANAGED,
        },
        lifeCycle: LifeCycle.EXTERNALLY_MANAGED,
      });

      expect(pipeline.deadLetterQueue).to.not.be.undefined;
      expect(pipeline.deadLetterQueue?.config.lifeCycle).to.equal(
        LifeCycle.FULLY_MANAGED,
      );
    });

    it("should propagate lifeCycle to all components (table, stream, deadLetterQueue)", () => {
      const pipeline = new IngestPipeline<TestData>("TestPipeline", {
        table: {
          orderByFields: ["id"],
        },
        stream: {
          parallelism: 1,
        },
        ingestApi: false,
        deadLetterQueue: {
          parallelism: 1,
        },
        lifeCycle: LifeCycle.DELETION_PROTECTED,
      });

      expect(pipeline.table).to.not.be.undefined;
      expect(pipeline.table?.config.lifeCycle).to.equal(
        LifeCycle.DELETION_PROTECTED,
      );
      expect(pipeline.stream).to.not.be.undefined;
      expect(pipeline.stream?.config.lifeCycle).to.equal(
        LifeCycle.DELETION_PROTECTED,
      );
      expect(pipeline.deadLetterQueue).to.not.be.undefined;
      expect(pipeline.deadLetterQueue?.config.lifeCycle).to.equal(
        LifeCycle.DELETION_PROTECTED,
      );
    });
  });
});
