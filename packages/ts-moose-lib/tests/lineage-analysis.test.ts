import * as fs from "node:fs";
import * as path from "node:path";
import { expect } from "chai";
import {
  Api,
  OlapTable,
  Stream,
  Task,
  WebApp,
  Workflow,
  IngestPipeline,
} from "../src/dmv2/index";
import { getMooseInternal, toInfraMap } from "../src/dmv2/internal";
import { ApiHelpers, sql } from "../src/index";

describe("Lineage Analysis", function () {
  this.timeout(30000);

  beforeEach(() => {
    const registry = getMooseInternal();
    registry.tables.clear();
    registry.streams.clear();
    registry.ingestApis.clear();
    registry.apis.clear();
    registry.sqlResources.clear();
    registry.workflows.clear();
    registry.webApps.clear();
    registry.materializedViews.clear();
    registry.views.clear();
  });

  it("infers transitive pulls_data_from for APIs", () => {
    interface ApiParams {
      id?: string;
    }

    interface ApiResponse {
      id: string;
    }

    interface TableRow {
      id: string;
    }

    const table = new OlapTable<TableRow>("LineageApiTable");

    const queryBuilder = () => sql`SELECT ${table.columns.id} FROM ${table}`;
    const secondHop = () => queryBuilder();

    const handler = async (_params: ApiParams): Promise<ApiResponse[]> => {
      secondHop();
      return [];
    };

    new Api<ApiParams, ApiResponse[]>("lineageApi", handler);

    const infra = toInfraMap(getMooseInternal());
    expect(infra.apis.lineageApi.pullsDataFrom).to.deep.include({
      id: "LineageApiTable",
      kind: "Table",
    });
  });

  it("infers pulls_data_from for ApiHelpers.table helper calls", () => {
    interface ApiParams {
      metric: string;
    }

    interface ApiResponse {
      id: string;
    }

    interface TableRow {
      id: string;
    }

    new OlapTable<TableRow>("LineageApiHelpersTable");

    const getTableRef = (_metric: string) =>
      ApiHelpers.table("LineageApiHelpersTable");

    const handler = async (
      params: ApiParams,
      { client }: any,
    ): Promise<ApiResponse[]> => {
      await client.query.execute(
        sql`SELECT * FROM ${getTableRef(params.metric)}`,
      );
      return [];
    };

    new Api<ApiParams, ApiResponse[]>("lineageApiHelpers", handler);

    const infra = toInfraMap(getMooseInternal());
    expect(infra.apis.lineageApiHelpers.pullsDataFrom).to.deep.include({
      id: "LineageApiHelpersTable",
      kind: "Table",
    });
  });

  it("infers pulls_data_from through transpiled-style comma callee calls", () => {
    interface ApiParams {
      metric: string;
    }

    interface ApiResponse {
      id: string;
    }

    interface TableRow {
      id: string;
    }

    new OlapTable<TableRow>("LineageCommaCallTable");

    const getTableRef = (_metric: string) =>
      ApiHelpers.table("LineageCommaCallTable");

    const invokeLikeTranspiledImportCall = (metric: string) =>
      // @ts-expect-error - emulate transpiled import call shape `(0, fn)(...)`.
      (0, getTableRef)(metric);

    const handler = async (
      params: ApiParams,
      { client }: any,
    ): Promise<ApiResponse[]> => {
      await client.query.execute(
        sql`SELECT * FROM ${invokeLikeTranspiledImportCall(params.metric)}`,
      );
      return [];
    };

    new Api<ApiParams, ApiResponse[]>("lineageCommaCallApi", handler);

    const infra = toInfraMap(getMooseInternal());
    expect(infra.apis.lineageCommaCallApi.pullsDataFrom).to.deep.include({
      id: "LineageCommaCallTable",
      kind: "Table",
    });
  });

  it("infers pulls_data_from for compiled-style sql(...) calls", () => {
    interface QueryParams {}

    interface ApiResponse {
      id: string;
    }

    interface TableRow {
      id: string;
    }

    const table = new OlapTable<TableRow>("LineageSqlCallTable");

    const handler = async (
      _params: QueryParams,
      { client }: any,
    ): Promise<ApiResponse[]> => {
      await client.query.execute(sql(["SELECT * FROM ", ""] as const, table));
      return [];
    };

    new Api<QueryParams, ApiResponse[]>("lineageSqlCallApi", handler);

    const infra = toInfraMap(getMooseInternal());
    expect(infra.apis.lineageSqlCallApi.pullsDataFrom).to.deep.include({
      id: "LineageSqlCallTable",
      kind: "Table",
    });
  });

  it("infers pulls_data_from from sql table-name fragments", () => {
    interface QueryParams {}

    interface ApiResponse {
      id: string;
    }

    interface TableRow {
      id: string;
    }

    new OlapTable<TableRow>("LineageSqlFragmentTable");

    const buildQuery = () => {
      const tableName = sql`LineageSqlFragmentTable`;
      return sql`SELECT * FROM ${tableName}`;
    };

    const handler = async (
      _params: QueryParams,
      { client }: any,
    ): Promise<ApiResponse[]> => {
      await client.query.execute(buildQuery());
      return [];
    };

    new Api<QueryParams, ApiResponse[]>("lineageSqlFragmentApi", handler);

    const infra = toInfraMap(getMooseInternal());
    expect(infra.apis.lineageSqlFragmentApi.pullsDataFrom).to.deep.include({
      id: "LineageSqlFragmentTable",
      kind: "Table",
    });
  });

  it("maps ingest pipeline SQL table aliases to local table ids", () => {
    interface PipelineRow {
      deployId: string;
      timestampMs: number;
      type: string;
      stepName: string;
      severity: string;
    }

    new IngestPipeline<PipelineRow>("LineagePipelineSqlAlias", {
      table: true,
      stream: true,
      ingestApi: true,
      version: "0.0",
    });

    interface QueryParams {}

    const handler = async (_params: QueryParams, { client }: any) => {
      const tableName = sql`LineagePipelineSqlAlias_0_0`;
      await client.query.execute(sql`SELECT * FROM ${tableName}`);
      return [];
    };

    new Api<QueryParams, any[]>("lineagePipelineSqlAliasApi", handler);

    const infra = toInfraMap(getMooseInternal());
    const candidateTableIds = new Set(
      [...getMooseInternal().tables.keys()].filter((id) =>
        id.includes("LineagePipelineSqlAlias"),
      ),
    );
    expect(candidateTableIds.size).to.be.greaterThan(0);

    const pulls = infra.apis.lineagePipelineSqlAliasApi.pullsDataFrom;
    expect(
      pulls.some(
        (pull) => pull.kind === "Table" && candidateTableIds.has(pull.id),
      ),
      `Expected pulls to include one of ${JSON.stringify([...candidateTableIds])}. Actual: ${JSON.stringify(pulls)}`,
    ).to.equal(true);
  });

  it("infers pulls_data_from for CommonJS exported table symbols", () => {
    const generatedDir = path.join(__dirname, ".lineage-generated");
    fs.mkdirSync(generatedDir, { recursive: true });

    const fixturePath = path.join(
      generatedDir,
      `lineage-cjs-${Date.now()}-${Math.random().toString(16).slice(2)}.api.js`,
    );
    const mooseLibEntry = path.resolve(__dirname, "../src/index.ts");

    const fixtureSource = `
const { Api, OlapTable, sql } = require(${JSON.stringify(mooseLibEntry)});

const schema = {
  version: "3.1",
  schemas: [{ type: "object", properties: {}, required: [] }],
  components: { schemas: {} },
};
const columns = [];

exports.LineageCommonJsTable = new OlapTable(
  "LineageCommonJsTable",
  {},
  schema,
  columns
);
exports.LineageCommonJsApi = new Api(
  "lineageCommonJsApi",
  async (_params, { client }) => {
    await client.query.execute(sql\`SELECT * FROM \${exports.LineageCommonJsTable}\`);
    return [];
  },
  { version: "0.0" },
  schema,
  columns
);
`;

    fs.writeFileSync(fixturePath, fixtureSource, "utf8");

    try {
      delete require.cache[require.resolve(fixturePath)];
      require(fixturePath);

      const infra = toInfraMap(getMooseInternal());
      const commonJsApi =
        infra.apis.lineageCommonJsApi ?? infra.apis["lineageCommonJsApi:0.0"];
      expect(commonJsApi?.pullsDataFrom).to.deep.include({
        id: "LineageCommonJsTable",
        kind: "Table",
      });
    } finally {
      try {
        delete require.cache[require.resolve(fixturePath)];
      } catch {
        // Ignore cleanup misses for generated fixture modules.
      }
      fs.rmSync(fixturePath, { force: true });
    }
  });

  it("infers pulls_data_from for compiled template-object sql fallbacks", () => {
    const generatedDir = path.join(__dirname, ".lineage-generated");
    fs.mkdirSync(generatedDir, { recursive: true });

    const fixturePath = path.join(
      generatedDir,
      `lineage-cjs-templateobj-${Date.now()}-${Math.random().toString(16).slice(2)}.api.js`,
    );
    const mooseLibEntry = path.resolve(__dirname, "../src/index.ts");

    const fixtureSource = `
const { Api, OlapTable, sql } = require(${JSON.stringify(mooseLibEntry)});

const schema = {
  version: "3.1",
  schemas: [{ type: "object", properties: {}, required: [] }],
  components: { schemas: {} },
};
const columns = [];

new OlapTable("LineageCompiledTemplateObjectTable", {}, schema, columns);

function __makeTemplateObject(cooked, raw) {
  cooked.raw = raw;
  return cooked;
}
var templateObject_1;
var templateObject_2;
var tableName = sql(
  templateObject_1 || (templateObject_1 = __makeTemplateObject(
    ["LineageCompiledTemplateObjectTable"],
    ["LineageCompiledTemplateObjectTable"]
  ))
);

new Api(
  "lineageCompiledTemplateObjectApi",
  async (_params, { client }) => {
    await client.query.execute(sql(
      templateObject_2 || (templateObject_2 = __makeTemplateObject(
        ["SELECT * FROM ", ""],
        ["SELECT * FROM ", ""]
      )),
      tableName
    ));
    return [];
  },
  { version: "0.0" },
  schema,
  columns
);
`;

    fs.writeFileSync(fixturePath, fixtureSource, "utf8");

    try {
      delete require.cache[require.resolve(fixturePath)];
      require(fixturePath);

      const infra = toInfraMap(getMooseInternal());
      const api =
        infra.apis.lineageCompiledTemplateObjectApi ??
        infra.apis["lineageCompiledTemplateObjectApi:0.0"];
      expect(api?.pullsDataFrom).to.deep.include({
        id: "LineageCompiledTemplateObjectTable",
        kind: "Table",
      });
    } finally {
      try {
        delete require.cache[require.resolve(fixturePath)];
      } catch {
        // Ignore cleanup misses for generated fixture modules.
      }
      fs.rmSync(fixturePath, { force: true });
    }
  });

  it("invalidates cached lineage when API registry mutates", () => {
    interface ApiParams {
      id?: string;
    }

    interface ApiResponse {
      id: string;
    }

    interface TableRow {
      id: string;
    }

    const firstTable = new OlapTable<TableRow>("LineageCacheTableA");
    const secondTable = new OlapTable<TableRow>("LineageCacheTableB");

    const firstHandler = async (_params: ApiParams): Promise<ApiResponse[]> => {
      sql`SELECT ${firstTable.columns.id} FROM ${firstTable}`;
      return [];
    };
    new Api<ApiParams, ApiResponse[]>("lineageCacheApiA", firstHandler);

    const firstInfra = toInfraMap(getMooseInternal());
    expect(firstInfra.apis.lineageCacheApiA.pullsDataFrom).to.deep.include({
      id: "LineageCacheTableA",
      kind: "Table",
    });

    getMooseInternal().apis.clear();

    const secondHandler = async (
      _params: ApiParams,
    ): Promise<ApiResponse[]> => {
      sql`SELECT ${secondTable.columns.id} FROM ${secondTable}`;
      return [];
    };
    new Api<ApiParams, ApiResponse[]>("lineageCacheApiB", secondHandler);

    const secondInfra = toInfraMap(getMooseInternal());
    expect(secondInfra.apis.lineageCacheApiB.pullsDataFrom).to.deep.include({
      id: "LineageCacheTableB",
      kind: "Table",
    });
    expect(secondInfra.apis.lineageCacheApiB.pullsDataFrom).to.not.deep.include(
      {
        id: "LineageCacheTableA",
        kind: "Table",
      },
    );
  });

  it("infers transitive pushes_data_to for workflow task call chains", () => {
    interface WorkflowRow {
      id: string;
      value: number;
    }

    const stream = new Stream<WorkflowRow>("LineageWorkflowTopic");
    const table = new OlapTable<WorkflowRow>("LineageWorkflowTable");

    const deepestWrite = async () => {
      await stream.send({ id: "1", value: 1 });
      await table.insert([{ id: "1", value: 1 }]);
    };

    const middleWrite = async () => {
      await deepestWrite();
    };

    const task = new Task<null, void>("lineageTask", {
      run: async () => {
        await middleWrite();
      },
    });

    new Workflow("lineageWorkflow", { startingTask: task });

    const infra = toInfraMap(getMooseInternal());
    expect(infra.workflows.lineageWorkflow.pushesDataTo).to.deep.include({
      id: "LineageWorkflowTopic",
      kind: "Topic",
    });
    expect(infra.workflows.lineageWorkflow.pushesDataTo).to.deep.include({
      id: "LineageWorkflowTable",
      kind: "Table",
    });
  });

  it("infers webapp lineage from handler call chains", () => {
    interface WebAppRow {
      id: string;
      value: number;
    }

    const stream = new Stream<WebAppRow>("LineageWebAppTopic");
    const table = new OlapTable<WebAppRow>("LineageWebAppTable");

    const readHelper = () => sql`SELECT ${table.columns.id} FROM ${table}`;
    const writeHelper = async () => {
      await stream.send({ id: "1", value: 1 });
      await table.insert([{ id: "1", value: 1 }]);
    };

    const app = {
      handle: async (_req: any, res: any) => {
        readHelper();
        await writeHelper();
        res.end("ok");
      },
    };

    new WebApp("lineageWebApp", app, { mountPath: "/lineage-webapp" });

    const infra = toInfraMap(getMooseInternal());
    expect(infra.webApps.lineageWebApp.pullsDataFrom).to.deep.include({
      id: "LineageWebAppTable",
      kind: "Table",
    });
    expect(infra.webApps.lineageWebApp.pushesDataTo).to.deep.include({
      id: "LineageWebAppTopic",
      kind: "Topic",
    });
    expect(infra.webApps.lineageWebApp.pushesDataTo).to.deep.include({
      id: "LineageWebAppTable",
      kind: "Table",
    });
  });
});
