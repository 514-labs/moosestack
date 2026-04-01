import {
  createModelTool,
  type MooseUtils,
  type QueryModelBase,
  type RowPolicyOptions,
} from "@514labs/moose-lib";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatSemanticToolError } from "../errors/semantic-tool-errors";
import { createSemanticToolSuccessResult } from "./semantic-tool-output";

interface SemanticModelContext {
  queryClient: MooseUtils["client"]["query"];
  rowPolicyOptions?: RowPolicyOptions;
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

function createRLSAwareQueryClient(
  queryClient: MooseUtils["client"]["query"],
  rowPolicyOptions?: RowPolicyOptions,
): MooseUtils["client"]["query"] {
  if (!rowPolicyOptions) {
    return queryClient;
  }

  return {
    ...queryClient,
    client: {
      ...queryClient.client,
      query: (params: Parameters<typeof queryClient.client.query>[0]) => {
        return queryClient.client.query({
          ...params,
          clickhouse_settings: {
            ...rowPolicyOptions.clickhouse_settings,
            ...params.clickhouse_settings,
            readonly: "2",
          },
          role: rowPolicyOptions.role ?? params.role,
        });
      },
    },
  } as MooseUtils["client"]["query"];
}

export function registerSemanticModelTools(
  server: McpServer,
  models: QueryModelBase[],
  context: SemanticModelContext,
): void {
  const rlsQueryClient = createRLSAwareQueryClient(
    context.queryClient,
    context.rowPolicyOptions,
  );

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
          const rows = await executableModel.query(request, rlsQueryClient);

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
