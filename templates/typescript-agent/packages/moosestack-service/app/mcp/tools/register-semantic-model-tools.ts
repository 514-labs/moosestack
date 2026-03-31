import {
  createModelTool,
  type MooseUtils,
  type QueryModelBase,
  type RowPolicyOptions,
} from "@514labs/moose-lib";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeReadonlySql } from "../../data/clickhouse/readonly-query";

interface SemanticModelContext {
  queryClient: MooseUtils["client"]["query"];
  rowPolicyOptions: RowPolicyOptions;
}

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

    const toolName = model.name;
    const toolDescription = model.description ?? toolName;
    const tool = createModelTool(model);
    const defaultLimit = model.defaults?.limit ?? 100;

    server.tool(
      toolName,
      toolDescription,
      tool.schema as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      { title: titleFromName(toolName) },
      async (params: Record<string, unknown>) => {
        try {
          const request = tool.buildRequest(params);
          const limit =
            typeof params.limit === "number" ? params.limit : defaultLimit;
          const rows = await executeReadonlySql<Record<string, unknown>>(
            context.queryClient,
            model.toSql(request),
            {
              limit,
              rowPolicyOptions: context.rowPolicyOptions,
            },
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ rows, rowCount: rows.length }, null, 2),
              },
            ],
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          const safeMessage =
            message.length > 200 ? `${message.slice(0, 200)}...` : message;

          return {
            content: [
              {
                type: "text" as const,
                text: `Error in ${toolName}: ${safeMessage}`,
              },
            ],
            isError: true,
          };
        }
      },
    );
  }
}
