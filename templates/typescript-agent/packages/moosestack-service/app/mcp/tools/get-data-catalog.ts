import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import {
  parseCatalogComponentType,
  parseCatalogFormat,
} from "../parsers/catalog-params";
import {
  formatExposedCatalogDetailed,
  formatExposedCatalogSummary,
  getExposedDataCatalog,
} from "../tool-access/exposed-surface";

export function registerGetDataCatalogTool(server: McpServer) {
  server.registerTool(
    "get_data_catalog",
    {
      title: "Get Data Catalog",
      description:
        "Discover the explicitly exposed tables and materialized views available to the agent, together with their schema information. Use this before writing queries instead of inspecting system metadata.",
      inputSchema: {
        component_type: z
          .string()
          .optional()
          .describe(
            "Optional component type filter. Allowed values: tables or materialized_views.",
          ),
        search: z
          .string()
          .optional()
          .describe("Regex pattern to search for in component names"),
        format: z
          .string()
          .optional()
          .describe(
            "Optional output format. Allowed values: summary or detailed.",
          ),
      },
    },
    async ({ component_type, search, format = "summary" }) => {
      try {
        const resolvedComponentType = parseCatalogComponentType(component_type);
        const resolvedFormat = parseCatalogFormat(format);
        const { tables, materializedViews } = getExposedDataCatalog(
          resolvedComponentType,
          search,
        );

        const output =
          resolvedFormat === "detailed" ?
            formatExposedCatalogDetailed(tables, materializedViews)
          : formatExposedCatalogSummary(tables, materializedViews);

        return {
          content: [
            {
              type: "text" as const,
              text: output,
            },
          ],
        };
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error retrieving data catalog: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
