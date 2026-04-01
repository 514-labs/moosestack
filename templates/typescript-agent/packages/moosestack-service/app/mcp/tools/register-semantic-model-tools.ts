import {
  createModelTool,
  type MooseUtils,
  type QueryModelBase,
  type RowPolicyOptions,
  type Sql,
} from "@514labs/moose-lib";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatSemanticToolError } from "../errors/semantic-tool-errors";
import { createSemanticToolSuccessResult } from "./semantic-tool-output";

interface SemanticModelContext {
  queryClient: MooseUtils["client"]["query"];
  rowPolicyOptions?: RowPolicyOptions;
}

function wrapQueryClientWithRowPolicies(
  queryClient: MooseUtils["client"]["query"],
  rowPolicyOptions: RowPolicyOptions,
): MooseUtils["client"]["query"] {
  const originalExecute = queryClient.execute.bind(queryClient);

  return {
    ...queryClient,
    execute: async <T>(sql: Sql) => {
      const result = await originalExecute<T>(sql);
      const originalJson = result.json.bind(result);

      return {
        ...result,
        json: async () => {
          const data = await originalJson();
          return data;
        },
      } as Awaited<ReturnType<typeof originalExecute<T>>>;
    },
    client: {
      ...queryClient.client,
      query: async (params: Parameters<typeof queryClient.client.query>[0]) => {
        return queryClient.client.query({
          ...params,
          clickhouse_settings: {
            ...rowPolicyOptions.clickhouse_settings,
            ...params.clickhouse_settings,
          },
          ...(rowPolicyOptions.role && { role: rowPolicyOptions.role }),
        });
      },
    },
  };
}

type McpToolSchema = Parameters<McpServer["tool"]>[2];
type ExecutableQueryModel = QueryModelBase & {
  query(
    request: Record<string, unknown>,
    queryClient: MooseUtils["client"]["query"],
  ): Promise<Array<Record<string, unknown>>>;
};

function titleFromName(name: string): string {
  return name
    .replace(/^query_/, "Query ")
    .replace(/^list_/, "List ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function registerSemanticModelTools(
  server: McpServer,
  models: QueryModelBase[],
  context: SemanticModelContext,
): void {
  for (const model of models) {
    if (!model.name) {
      continue;
    }

    const executableModel = model as ExecutableQueryModel;
    const toolName = model.name;
    const toolTitle = titleFromName(toolName);
    const toolDescription = model.description ?? toolName;
    const tool = createModelTool(model);
    const defaultLimit = model.defaults?.limit ?? 100;
    const toolSchema = tool.schema as unknown as McpToolSchema;

    server.tool(
      toolName,
      toolDescription,
      toolSchema,
      { title: toolTitle },
      async (params: Record<string, unknown>) => {
        try {
          const limit =
            typeof params.limit === "number" && !Number.isNaN(params.limit) ?
              params.limit
            : defaultLimit;
          const request = tool.buildRequest({
            ...params,
            limit,
          });

          const queryClient =
            context.rowPolicyOptions ?
              wrapQueryClientWithRowPolicies(
                context.queryClient,
                context.rowPolicyOptions,
              )
            : context.queryClient;

          const rows = await executableModel.query(request, queryClient);

          return createSemanticToolSuccessResult(
            toolName,
            toolTitle,
            model,
            rows,
          );
        } catch (error) {
          console.error(`${toolName} failed:`, error);

          return {
            content: [
              {
                type: "text" as const,
                text: formatSemanticToolError(error, toolTitle),
              },
            ],
            isError: true,
          };
        }
      },
    );
  }
}
