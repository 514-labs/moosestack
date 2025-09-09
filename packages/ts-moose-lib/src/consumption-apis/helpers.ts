import { ClickHouseClient, ResultSet } from "@clickhouse/client";
import {
  Client as TemporalClient,
  Connection,
  ConnectionOptions,
} from "@temporalio/client";
import { StringValue } from "@temporalio/common";
import { createHash, randomUUID } from "node:crypto";
import { performance } from "perf_hooks";
import prettyMs from "pretty-ms";
import * as fs from "fs";
import { getWorkflows } from "../dmv2/internal";
import { JWTPayload } from "jose";
import { Sql, sql, RawValue, toQuery } from "../sqlHelpers";

export interface ApiUtil {
  client: MooseClient;

  // SQL interpolator
  sql: typeof sql;
  jwt: JWTPayload | undefined;
}

/** @deprecated Use ApiUtil instead. */
export type ConsumptionUtil = ApiUtil;

export class MooseClient {
  query: QueryClient;
  workflow: WorkflowClient;

  constructor(queryClient: QueryClient, temporalClient?: TemporalClient) {
    this.query = queryClient;
    this.workflow = new WorkflowClient(temporalClient);
  }
}

export class QueryClient {
  client: ClickHouseClient;
  query_id_prefix: string;
  constructor(client: ClickHouseClient, query_id_prefix: string) {
    this.client = client;
    this.query_id_prefix = query_id_prefix;
  }

  async execute<T = any>(
    sql: Sql,
  ): Promise<ResultSet<"JSONEachRow"> & { __query_result_t?: T[] }> {
    const [query, query_params] = toQuery(sql);

    this.printQuery(query, query_params);
    const start = performance.now();
    const result = await this.client.query({
      query,
      query_params,
      format: "JSONEachRow",
      query_id: this.query_id_prefix + randomUUID(),
      // Note: wait_end_of_query deliberately NOT set here as this is used for SELECT queries
      // where response buffering would harm streaming performance and concurrency
    });
    const elapsedMs = performance.now() - start;
    console.log(`[QueryClient] | Query completed: ${prettyMs(elapsedMs)}`);
    return result;
  }

  private printQuery(query: string, query_params: { [pN: string]: any }) {
    try {
      const formatValue = (v: any): string => {
        if (Array.isArray(v)) return `[${v.map(formatValue).join(", ")}]`;
        if (v === null || v === undefined) return "NULL";
        switch (typeof v) {
          case "string":
            return `'${v.replace(/'/g, "''")}'`;
          case "number":
            return String(v);
          case "boolean":
            return v ? "true" : "false";
          default:
            try {
              return JSON.stringify(v);
            } catch {
              return String(v);
            }
        }
      };

      const substitutedQuery = query.replace(
        /\{(p\d+):[^}]+\}/g,
        (m, pName) => {
          const val = (query_params as any)[pName];
          return val === undefined ? m : formatValue(val);
        },
      );

      console.log(
        `[QueryClient] | Query: ${substitutedQuery.replace(/\s+/g, " ").trim()}`,
      );
    } catch (error) {
      console.log(`Error substituting query params for logging: ${error}`);
      console.log(
        `[QueryClient] | Query: ${query.replace(/\s+/g, " ").trim()}`,
      );
      console.log(
        `[QueryClient] | Query params: ${JSON.stringify(query_params)}`,
      );
    }
  }
}

export class WorkflowClient {
  client: TemporalClient | undefined;

  constructor(temporalClient?: TemporalClient) {
    this.client = temporalClient;
  }

  async execute(name: string, input_data: any) {
    try {
      if (!this.client) {
        return {
          status: 404,
          body: `Temporal client not found. Is the feature flag enabled?`,
        };
      }

      // Get workflow configuration
      const config = await this.getWorkflowConfig(name);

      // Process input data and generate workflow ID
      const [processedInput, workflowId] = this.processInputData(
        name,
        input_data,
      );

      console.log(
        `WorkflowClient - starting workflow: ${name} with config ${JSON.stringify(config)} and input_data ${JSON.stringify(processedInput)}`,
      );

      const handle = await this.client.workflow.start("ScriptWorkflow", {
        args: [
          { workflow_name: name, execution_mode: "start" as const },
          processedInput,
        ],
        taskQueue: "typescript-script-queue",
        workflowId,
        workflowIdConflictPolicy: "FAIL",
        workflowIdReusePolicy: "ALLOW_DUPLICATE",
        retry: {
          maximumAttempts: config.retries,
        },
        workflowRunTimeout: config.timeout as StringValue,
      });

      return {
        status: 200,
        body: `Workflow started: ${name}. View it in the Temporal dashboard: http://localhost:8080/namespaces/default/workflows/${workflowId}/${handle.firstExecutionRunId}/history`,
      };
    } catch (error) {
      return {
        status: 400,
        body: `Error starting workflow: ${error}`,
      };
    }
  }

  async terminate(workflowId: string) {
    try {
      if (!this.client) {
        return {
          status: 404,
          body: `Temporal client not found. Is the feature flag enabled?`,
        };
      }

      const handle = this.client.workflow.getHandle(workflowId);
      await handle.terminate();

      return {
        status: 200,
        body: `Workflow terminated: ${workflowId}`,
      };
    } catch (error) {
      return {
        status: 400,
        body: `Error terminating workflow: ${error}`,
      };
    }
  }

  private async getWorkflowConfig(
    name: string,
  ): Promise<{ retries: number; timeout: string }> {
    const workflows = await getWorkflows();
    const dmv2Workflow = workflows.get(name);
    if (dmv2Workflow) {
      return {
        retries: dmv2Workflow.config.retries || 3,
        timeout: dmv2Workflow.config.timeout || "1h",
      };
    }

    throw new Error(`Workflow config not found for ${name}`);
  }

  private processInputData(name: string, input_data: any): [any, string] {
    let workflowId = name;
    if (input_data) {
      const hash = createHash("sha256")
        .update(JSON.stringify(input_data))
        .digest("hex")
        .slice(0, 16);
      workflowId = `${name}-${hash}`;
    }
    return [input_data, workflowId];
  }
}

/**
 * This looks similar to the client in runner.ts which is a worker.
 * Temporal SDK uses similar looking connection options & client,
 * but there are different libraries for a worker & client like this one
 * that triggers workflows.
 */
export async function getTemporalClient(
  temporalUrl: string,
  namespace: string,
  clientCert: string,
  clientKey: string,
  apiKey: string,
): Promise<TemporalClient | undefined> {
  try {
    console.info(
      `<api> Using temporal_url: ${temporalUrl} and namespace: ${namespace}`,
    );

    let connectionOptions: ConnectionOptions = {
      address: temporalUrl,
      connectTimeout: "3s",
    };

    if (clientCert && clientKey) {
      // URL with mTLS uses gRPC namespace endpoint which is what temporalUrl already is
      console.log("Using TLS for secure Temporal");
      const cert = await fs.readFileSync(clientCert);
      const key = await fs.readFileSync(clientKey);

      connectionOptions.tls = {
        clientCertPair: { crt: cert, key: key },
      };
    } else if (apiKey) {
      console.log("Using API key for secure Temporal");
      // URL with API key uses gRPC regional endpoint
      connectionOptions.address = "us-west1.gcp.api.temporal.io:7233";
      connectionOptions.apiKey = apiKey;
      connectionOptions.tls = {};
      connectionOptions.metadata = {
        "temporal-namespace": namespace,
      };
    }

    console.log(`<api> Connecting to Temporal at ${connectionOptions.address}`);
    const connection = await Connection.connect(connectionOptions);
    const client = new TemporalClient({ connection, namespace });
    console.log("<api> Connected to Temporal server");

    return client;
  } catch (error) {
    console.warn(`Failed to connect to Temporal. Is the feature flag enabled?`);
    console.warn(error);
    return undefined;
  }
}

export const ApiHelpers = {
  column: (value: string) => ["Identifier", value] as [string, string],
  table: (value: string) => ["Identifier", value] as [string, string],
};

/** @deprecated Use ApiHelpers instead. */
export const ConsumptionHelpers = ApiHelpers;

export function joinQueries({
  values,
  separator = ",",
  prefix = "",
  suffix = "",
}: {
  values: readonly RawValue[];
  separator?: string;
  prefix?: string;
  suffix?: string;
}) {
  if (values.length === 0) {
    throw new TypeError(
      "Expected `join([])` to be called with an array of multiple elements, but got an empty array",
    );
  }

  return new Sql(
    [prefix, ...Array(values.length - 1).fill(separator), suffix],
    values,
  );
}
