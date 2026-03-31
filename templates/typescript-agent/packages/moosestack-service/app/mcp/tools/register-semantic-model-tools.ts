import {
  createModelTool,
  type MooseUtils,
  type QueryModelBase,
  type RowPolicyOptions,
} from "@514labs/moose-lib";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeReadonlySql } from "../../data/clickhouse/readonly-query";
import { formatSemanticToolError } from "../errors/semantic-tool-errors";
import { createSemanticToolSuccessResult } from "./semantic-tool-output";

interface SemanticModelContext {
  queryClient: MooseUtils["client"]["query"];
  rowPolicyOptions: RowPolicyOptions;
}

type McpToolSchema = Parameters<McpServer["tool"]>[2];

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
