import { expect } from "chai";
import {
  Api,
  OlapTable,
  Stream,
  Task,
  WebApp,
  Workflow,
} from "../src/dmv2/index";
import { getMooseInternal, toInfraMap } from "../src/dmv2/internal";
import { sql } from "../src/index";

describe("Lineage Analysis", () => {
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
