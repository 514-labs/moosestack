/**
 * Test suite for the dmv2 registry functions
 */

import { expect } from "chai";
import {
  OlapTable,
  Stream,
  IngestApi,
  Api,
  SqlResource,
  Task,
  Workflow,
  WebApp,
  getTables,
  getTable,
  getStreams,
  getStream,
  getIngestApis,
  getIngestApi,
  getApis,
  getApi,
  getSqlResources,
  getSqlResource,
  getWorkflows,
  getWorkflow,
  getWebApps,
  getWebApp,
  getConsumptionApis,
  getConsumptionApi,
} from "../src/dmv2/index";
import { getMooseInternal } from "../src/dmv2/internal";

describe("Registry Functions", () => {
  beforeEach(() => {
    // Clear the registry before each test
    const registry = getMooseInternal();
    registry.tables.clear();
    registry.streams.clear();
    registry.ingestApis.clear();
    registry.apis.clear();
    registry.sqlResources.clear();
    registry.workflows.clear();
    registry.webApps.clear();
  });

  describe("Tables", () => {
    it("should register and retrieve tables", () => {
      interface TestData {
        id: string;
        value: number;
      }

      const table = new OlapTable<TestData>("TestTable", {
        orderByFields: ["id"],
      });

      const tables = getTables();
      expect(tables.size).to.equal(1);
      expect(tables.get("TestTable")).to.equal(table);

      const retrieved = getTable("TestTable");
      expect(retrieved).to.equal(table);
      expect(retrieved?.name).to.equal("TestTable");
    });

    it("should return undefined for non-existent table", () => {
      expect(getTable("NonExistent")).to.be.undefined;
    });
  });

  describe("Streams", () => {
    it("should register and retrieve streams", () => {
      interface TestData {
        id: string;
        value: number;
      }

      const stream = new Stream<TestData>("TestStream", {
        parallelism: 1,
      });

      const streams = getStreams();
      expect(streams.size).to.equal(1);
      expect(streams.get("TestStream")).to.equal(stream);

      const retrieved = getStream("TestStream");
      expect(retrieved).to.equal(stream);
      expect(retrieved?.name).to.equal("TestStream");
    });

    it("should return undefined for non-existent stream", () => {
      expect(getStream("NonExistent")).to.be.undefined;
    });
  });

  describe("Ingest APIs", () => {
    it("should register and retrieve ingest APIs", () => {
      interface TestData {
        id: string;
        value: number;
      }

      const stream = new Stream<TestData>("TargetStream");
      const api = new IngestApi<TestData>("TestIngestApi", {
        destination: stream,
      });

      const apis = getIngestApis();
      expect(apis.size).to.equal(1);
      expect(apis.get("TestIngestApi")).to.equal(api);

      const retrieved = getIngestApi("TestIngestApi");
      expect(retrieved).to.equal(api);
      expect(retrieved?.name).to.equal("TestIngestApi");
    });

    it("should return undefined for non-existent ingest API", () => {
      expect(getIngestApi("NonExistent")).to.be.undefined;
    });
  });

  describe("APIs (Consumption)", () => {
    it("should register and retrieve consumption APIs", () => {
      interface QueryParams {
        id: string;
      }
      interface Response {
        data: string;
      }

      const api = new Api<QueryParams, Response>(
        "TestApi",
        async () => ({ data: "test" }),
        {},
      );

      const apis = getApis();
      expect(apis.size).to.equal(1);
      expect(apis.get("TestApi")).to.equal(api);

      const retrieved = getApi("TestApi");
      expect(retrieved).to.equal(api);
      expect(retrieved?.name).to.equal("TestApi");
    });

    it("should retrieve versioned API by full key", () => {
      interface QueryParams {
        id: string;
      }
      interface Response {
        data: string;
      }

      const api = new Api<QueryParams, Response>(
        "TestApi",
        async () => ({ data: "v1" }),
        { version: "1.0" },
      );

      const retrieved = getApi("TestApi:1.0");
      expect(retrieved).to.equal(api);
    });

    it("should alias unversioned lookup when only one version exists", () => {
      interface QueryParams {
        id: string;
      }
      interface Response {
        data: string;
      }

      new Api<QueryParams, Response>("TestApi", async () => ({ data: "v1" }), {
        version: "1.0",
      });

      // Should find the versioned API when looking up by base name
      const retrieved = getApi("TestApi");
      expect(retrieved).to.not.be.undefined;
      expect(retrieved?.name).to.equal("TestApi");
      expect(retrieved?.config.version).to.equal("1.0");
    });

    it("should not alias when multiple versions exist", () => {
      interface QueryParams {
        id: string;
      }
      interface Response {
        data: string;
      }

      new Api<QueryParams, Response>("TestApi", async () => ({ data: "v1" }), {
        version: "1.0",
      });
      new Api<QueryParams, Response>("TestApi", async () => ({ data: "v2" }), {
        version: "2.0",
      });

      // Should not find anything with base name when multiple versions exist
      const retrieved = getApi("TestApi");
      expect(retrieved).to.be.undefined;
    });

    it("should retrieve API by custom path", () => {
      interface QueryParams {
        id: string;
      }
      interface Response {
        data: string;
      }

      const api = new Api<QueryParams, Response>(
        "TestApi",
        async () => ({ data: "test" }),
        { path: "/custom/path" },
      );

      const retrieved = getApi("/custom/path");
      expect(retrieved).to.equal(api);
    });

    it("should support backward compatibility aliases", () => {
      expect(getConsumptionApis).to.equal(getApis);
      expect(getConsumptionApi).to.equal(getApi);
    });

    it("should return undefined for non-existent API", () => {
      expect(getApi("NonExistent")).to.be.undefined;
    });
  });

  describe("SQL Resources", () => {
    it("should register and retrieve SQL resources", () => {
      interface TestData {
        id: string;
      }

      const table = new OlapTable<TestData>("TestTable");
      const resource = new SqlResource(
        "TestResource",
        ["CREATE VIEW test AS SELECT * FROM TestTable"],
        ["DROP VIEW test"],
        {
          pullsDataFrom: [table],
        },
      );

      const resources = getSqlResources();
      expect(resources.size).to.equal(1);
      expect(resources.get("TestResource")).to.equal(resource);

      const retrieved = getSqlResource("TestResource");
      expect(retrieved).to.equal(resource);
      expect(retrieved?.name).to.equal("TestResource");
    });

    it("should return undefined for non-existent SQL resource", () => {
      expect(getSqlResource("NonExistent")).to.be.undefined;
    });
  });

  describe("Workflows", () => {
    it("should register and retrieve workflows", () => {
      const task = new Task<null, void>("TestTask", {
        run: async () => {},
      });

      const workflow = new Workflow("TestWorkflow", {
        startingTask: task,
      });

      const workflows = getWorkflows();
      expect(workflows.size).to.equal(1);
      expect(workflows.get("TestWorkflow")).to.equal(workflow);

      const retrieved = getWorkflow("TestWorkflow");
      expect(retrieved).to.equal(workflow);
      expect(retrieved?.name).to.equal("TestWorkflow");
    });

    it("should return undefined for non-existent workflow", () => {
      expect(getWorkflow("NonExistent")).to.be.undefined;
    });
  });

  describe("WebApps", () => {
    it("should register and retrieve web apps", () => {
      const handler = async () => {};
      const app = new WebApp("TestApp", handler, {
        mountPath: "/test",
      });

      const apps = getWebApps();
      expect(apps.size).to.equal(1);
      expect(apps.get("TestApp")).to.equal(app);

      const retrieved = getWebApp("TestApp");
      expect(retrieved).to.equal(app);
      expect(retrieved?.name).to.equal("TestApp");
    });

    it("should return undefined for non-existent web app", () => {
      expect(getWebApp("NonExistent")).to.be.undefined;
    });
  });
});
