import {
  Client as TemporalClient,
  Connection,
  ConnectionOptions,
} from "@temporalio/client";
import { StringValue } from "@temporalio/common";
import { createHash } from "node:crypto";
import * as fs from "fs";
import { getWorkflows } from "../dmv2/internal";
import { JWTPayload } from "jose";
import { Sql, sql, RawValue } from "../sqlHelpers";
import { QueryClient, type RowPolicyOptions } from "./query-client";
export { QueryClient, type RowPolicyOptions } from "./query-client";

/**
 * Utilities provided by getMooseUtils() for database access and SQL queries.
 * Works in both Moose runtime and standalone contexts.
 */
export interface MooseUtils {
  client: MooseClient;
  sql: typeof sql;
  jwt?: JWTPayload;
}

/**
 * @deprecated Use MooseUtils instead. ApiUtil is now a type alias to MooseUtils
 * and will be removed in a future version.
 *
 * Migration: Replace `ApiUtil` with `MooseUtils` in your type annotations.
 */
export type ApiUtil = MooseUtils;

/** @deprecated Use MooseUtils instead. */
export type ConsumptionUtil = MooseUtils;

export class MooseClient {
  query: QueryClient;
  workflow: WorkflowClient;

  constructor(queryClient: QueryClient, temporalClient?: TemporalClient) {
    this.query = queryClient;
    this.workflow = new WorkflowClient(temporalClient);
  }
}

/**
 * Shared ClickHouse role name used by all row policies.
 * IMPORTANT: Must match MOOSE_RLS_ROLE in apps/framework-cli/src/framework/core/infrastructure/select_row_policy.rs
 */
export const MOOSE_RLS_ROLE = "moose_rls_role";

/**
 * Dedicated ClickHouse user for RLS queries.
 * Created at DDL time with SELECT-only permissions and the RLS role granted.
 * IMPORTANT: Must match MOOSE_RLS_USER in apps/framework-cli/src/framework/core/infrastructure/select_row_policy.rs
 */
export const MOOSE_RLS_USER = "moose_rls_user";

/**
 * Prefix for ClickHouse custom settings used by row policies.
 * Setting names are `{MOOSE_RLS_SETTING_PREFIX}{column}`.
 * IMPORTANT: Must match the format in setting_name() in apps/framework-cli/src/framework/core/infrastructure/select_row_policy.rs
 */
export const MOOSE_RLS_SETTING_PREFIX = "SQL_moose_rls_";

/** Config mapping ClickHouse setting names to JWT claim names */
export type RowPoliciesConfig = Record<string, string>;

/**
 * Build RowPolicyOptions from a row policies config and a claim-value source.
 * Only sets ClickHouse settings for claims that are present in the source.
 *
 * Missing claims are skipped — if a table's row policy calls getSetting()
 * for a setting that wasn't set, ClickHouse will error. This is correct:
 * it means the JWT is missing a claim that the queried table requires.
 * Tables whose policies don't reference the missing setting are unaffected.
 *
 * @param config  Maps ClickHouse setting name → claim name
 * @param claims  Maps claim name → claim value (e.g., JWT payload or rlsContext)
 * @returns RowPolicyOptions with the shared RLS role and populated settings
 */
export function buildRowPolicyOptionsFromClaims(
  config: RowPoliciesConfig,
  claims: Record<string, unknown>,
): RowPolicyOptions {
  const clickhouse_settings: Record<string, string> = Object.create(null);
  for (const [settingName, claimName] of Object.entries(config)) {
    const value = claims[claimName];
    if (value !== undefined && value !== null) {
      clickhouse_settings[settingName] = String(value);
    }
  }
  return { role: MOOSE_RLS_ROLE, clickhouse_settings };
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
          // Temporal's maximumAttempts = total attempts (initial + retries)
          maximumAttempts: config.retries + 1,
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
    const workflow = workflows.get(name);
    if (workflow) {
      return {
        retries: workflow.config.retries || 3,
        timeout: workflow.config.timeout || "1h",
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
