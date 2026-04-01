import {
  createModelTool,
  type MooseUtils,
  type QueryModelBase,
} from "@514labs/moose-lib";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatSemanticToolError } from "../errors/semantic-tool-errors";
import { createSemanticToolSuccessResult } from "./semantic-tool-output";

interface SemanticModelContext {
  queryClient: MooseUtils["client"]["query"];
}

type McpToolSchema = Parameters<McpServer["tool"]>[2];
type ExecutableQueryModel = QueryModelBase & {
  query(
    request: Record<string, unknown>,
    queryClient: MooseUtils["client"]["query"],
  ): Promise<unknown[]>;
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
  models: ExecutableQueryModel[],
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
          const limit =
            typeof params.limit === "number" && !Number.isNaN(params.limit) ?
              params.limit
            : defaultLimit;
          const request = tool.buildRequest({
            ...params,
            limit,
          });
          const rows = await model.query(request, context.queryClient);

          return createSemanticToolSuccessResult(
            toolName,
            toolTitle,
            model,
            rows as Record<string, unknown>[],
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
