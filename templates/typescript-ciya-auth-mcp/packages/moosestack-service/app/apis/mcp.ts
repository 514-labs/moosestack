/**
 * MCP (Model Context Protocol) Server Implementation
 *
 * This file demonstrates how to integrate an MCP server with MooseStack using:
 * - Express.js for HTTP handling
 * - @modelcontextprotocol/sdk for MCP protocol implementation
 * - StreamableHTTPServerTransport with JSON responses (stateless mode)
 * - WebApp class to mount the server at a custom path (/tools)
 * - getMooseUtils() to access ClickHouse client and query utilities
 *
 * The MCP server exposes tools that AI assistants can use to query your data.
 * This is separate from MooseStack's built-in MCP server at /mcp.
 */

import express, { Request, Response, NextFunction } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod/v3";
import { WebApp, getMooseUtils, MooseUtils } from "@514labs/moose-lib";
import { createAuthMiddleware } from "@514labs/express-pbkdf2-api-key-auth";
import { jwtVerify, createRemoteJWKSet } from "jose";

/**
 * User context extracted from JWT claims (Tier 2/3).
 * Undefined for Tier 1 (PBKDF2 API key auth).
 */
export interface UserContext {
  userId: string;
  email?: string;
  name?: string;
  orgId?: string;
}

export function clickhouseReadonlyQuery(
  client: MooseUtils["client"],
  sql: string,
  limit = 100,
  queryParams?: Record<string, string>,
): ReturnType<MooseUtils["client"]["query"]["client"]["query"]> {
  return client.query.client.query({
    query: sql,
    format: "JSONEachRow",
    clickhouse_settings: {
      readonly: "2",
      limit: limit.toString(),
    },
    ...(queryParams && { query_params: queryParams }),
  });
}

/**
 * Query ClickHouse to get column information for a specific table.
 * Uses currentDatabase() to automatically query the active database context.
 */
async function getTableColumns(
  client: MooseUtils["client"],
  tableName: string,
): Promise<ColumnInfo[]> {
  const query = `
    SELECT
      name,
      type,
      type LIKE '%Nullable%' as nullable,
      comment
    FROM system.columns
    WHERE database = currentDatabase() AND table = '${tableName}'
    ORDER BY position
  `;

  // High limit for catalog queries - metadata tables are typically small
  const result = await clickhouseReadonlyQuery(client, query, 10000);
  const rawData = await result.json();
  const data = z.array(ColumnQueryResultSchema).parse(rawData);

  return data.map((row) => ({
    name: row.name,
    type: row.type,
    nullable: row.nullable === 1,
    comment: row.comment || undefined,
  }));
}

// Zod schemas for runtime validation of ClickHouse query results
const ColumnQueryResultSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.number(),
  comment: z.string(),
});

const TableQueryResultSchema = z.object({
  name: z.string(),
  engine: z.string(),
  component_type: z.string(),
});

type ColumnQueryResult = z.infer<typeof ColumnQueryResultSchema>;
type TableQueryResult = z.infer<typeof TableQueryResultSchema>;

/**
 * Query ClickHouse to get list of tables and materialized views in the configured database.
 * Uses currentDatabase() to automatically query the active database context.
 */
async function getTablesAndMaterializedViews(
  client: MooseUtils["client"],
  componentType?: string,
  searchPattern?: string,
): Promise<{
  tables: Array<{ name: string; engine: string }>;
  materializedViews: Array<{ name: string; engine: string }>;
}> {
  const query = `
    SELECT
      name,
      engine,
      CASE
        WHEN engine = 'MaterializedView' THEN 'materialized_view'
        ELSE 'table'
      END as component_type
    FROM system.tables
    WHERE database = currentDatabase()
    ORDER BY name
  `;

  // High limit for catalog queries - metadata tables are typically small
  const result = await clickhouseReadonlyQuery(client, query, 10000);
  const rawData = await result.json();
  const data = z.array(TableQueryResultSchema).parse(rawData);

  let filteredData = data;

  // Apply component type filter
  if (componentType) {
    filteredData = filteredData.filter((row) => {
      if (componentType === "tables") return row.component_type === "table";
      if (componentType === "materialized_views")
        return row.component_type === "materialized_view";
      return true;
    });
  }

  // Apply search pattern filter
  if (searchPattern) {
    try {
      const regex = new RegExp(searchPattern, "i");
      filteredData = filteredData.filter((row) => regex.test(row.name));
    } catch {
      // If regex is invalid, fall back to simple substring match
      filteredData = filteredData.filter((row) =>
        row.name.toLowerCase().includes(searchPattern.toLowerCase()),
      );
    }
  }

  const tables = filteredData
    .filter((row) => row.component_type === "table")
    .map((row) => ({ name: row.name, engine: row.engine }));

  const materializedViews = filteredData
    .filter((row) => row.component_type === "materialized_view")
    .map((row) => ({ name: row.name, engine: row.engine }));

  return { tables, materializedViews };
}

/**
 * Format catalog as summary (just names and column counts)
 */
async function formatCatalogSummary(
  client: MooseUtils["client"],
  tables: Array<{ name: string; engine: string }>,
  materializedViews: Array<{ name: string; engine: string }>,
): Promise<string> {
  let output = "# Data Catalog (Summary)\n\n";

  // Format tables
  if (tables.length > 0) {
    output += `## Tables (${tables.length})\n`;
    for (const table of tables) {
      const columns = await getTableColumns(client, table.name);
      output += `- ${table.name} (${columns.length} columns)\n`;
    }
    output += "\n";
  }

  // Format materialized views
  if (materializedViews.length > 0) {
    output += `## Materialized Views (${materializedViews.length})\n`;
    for (const mv of materializedViews) {
      const columns = await getTableColumns(client, mv.name);
      output += `- ${mv.name} (${columns.length} columns)\n`;
    }
    output += "\n";
  }

  if (tables.length === 0 && materializedViews.length === 0) {
    output = "No data components found matching the specified filters.";
  }

  return output;
}

/**
 * Format catalog as detailed JSON with full schema information
 */
async function formatCatalogDetailed(
  client: MooseUtils["client"],
  tables: Array<{ name: string; engine: string }>,
  materializedViews: Array<{ name: string; engine: string }>,
): Promise<string> {
  const catalog: DataCatalogResponse = {};

  // Build tables section
  if (tables.length > 0) {
    catalog.tables = {};
    for (const table of tables) {
      const columns = await getTableColumns(client, table.name);
      catalog.tables[table.name] = {
        name: table.name,
        engine: table.engine,
        columns,
      };
    }
  }

  // Build materialized views section
  if (materializedViews.length > 0) {
    catalog.materialized_views = {};
    for (const mv of materializedViews) {
      const columns = await getTableColumns(client, mv.name);
      catalog.materialized_views[mv.name] = {
        name: mv.name,
        engine: mv.engine,
        columns,
      };
    }
  }

  return JSON.stringify(catalog, null, 2);
}

/**
 * Column information from ClickHouse system.columns
 */
interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  comment?: string;
}

/**
 * Table information from ClickHouse system.tables
 */
interface TableInfo {
  name: string;
  engine: string;
  total_rows?: number;
  total_bytes?: number;
  columns: ColumnInfo[];
}

/**
 * Catalog response structure
 */
interface DataCatalogResponse {
  tables?: Record<string, TableInfo>;
  materialized_views?: Record<string, TableInfo>;
}

// Create Express application
const app = express();
app.use(express.json());

// Dual-mode auth: auto-detects PBKDF2 API key vs JWT from token format.
// - Token with 3 dot-separated segments → JWT path (Tier 2/3)
// - Otherwise → PBKDF2 path (Tier 1)
// - No token + no auth configured → dev mode (allow, no context)

const mcpApiKey = process.env.MCP_API_KEY;
const jwksUrl = process.env.JWKS_URL;

// Lazy-init JWKS keyset on first JWT request
let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function getJwks() {
  if (!jwks && jwksUrl) {
    jwks = createRemoteJWKSet(new URL(jwksUrl));
  }
  return jwks;
}

export function isJwt(token: string): boolean {
  return token.split(".").length === 3;
}

const pbkdf2Middleware =
  mcpApiKey ? createAuthMiddleware(() => mcpApiKey) : undefined;

app.use(async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  const token =
    authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

  if (!token) {
    // No token: if PBKDF2 key is configured, reject; otherwise dev mode
    if (mcpApiKey) {
      res.status(401).json({ error: "Missing authorization token" });
      return;
    }
    (req as any).userContext = undefined;
    next();
    return;
  }

  if (isJwt(token) && jwksUrl) {
    // JWT path (Tier 2/3)
    try {
      const keyset = getJwks();
      if (!keyset) {
        res.status(500).json({ error: "JWKS not configured" });
        return;
      }
      const { payload } = await jwtVerify(token, keyset);
      // org_id may be in JWT claims (custom template) or in x-org-id header (Clerk default)
      const orgIdFromJwt = (payload.org_id as string) ?? undefined;
      const orgIdFromHeader = req.headers["x-org-id"] as string | undefined;
      const userContext: UserContext = {
        userId: payload.sub ?? "unknown",
        email: (payload.email as string) ?? undefined,
        name: (payload.name as string) ?? undefined,
        orgId: orgIdFromJwt ?? orgIdFromHeader,
      };
      (req as any).userContext = userContext;
      next();
    } catch (error) {
      console.error("[MCP Auth] JWT validation failed:", error);
      res.status(401).json({ error: "Invalid JWT" });
    }
  } else if (pbkdf2Middleware) {
    // PBKDF2 path (Tier 1)
    (req as any).userContext = undefined;
    pbkdf2Middleware(req, res, next);
  } else {
    // Dev mode: no auth configured
    (req as any).userContext = undefined;
    next();
  }
});

/**
 * Server factory function that creates a fresh McpServer instance for each request.
 * This is required for stateless mode where each request is fully independent.
 * The mooseUtils parameter provides access to ClickHouse client and SQL helpers.
 */
export const serverFactory = (
  mooseUtils: MooseUtils,
  userContext?: UserContext,
) => {
  const server = new McpServer({
    name: "moosestack-mcp-tools",
    version: "1.0.0",
  });

  /**
   * Register the query_clickhouse tool
   *
   * Allows AI assistants to execute SQL queries against ClickHouse.
   * Results are limited to max 1000 rows to prevent excessive data transfer.
   * Security is enforced at the database level using ClickHouse readonly mode.
   */
  server.tool(
    "query_clickhouse",
    "Execute a read-only query against the ClickHouse OLAP database and return results as JSON. Use SELECT, SHOW, DESCRIBE, or EXPLAIN queries only. Data modification queries (INSERT, UPDATE, DELETE, ALTER, CREATE, etc.) are prohibited.",
    {
      query: z.string().describe("SQL query to execute against ClickHouse"),
      limit: z
        .number()
        .min(1)
        .max(1000)
        .default(100)
        .optional()
        .describe("Maximum number of rows to return (default: 100, max: 1000)"),
    },
    {
      title: "Query ClickHouse Database",
    },
    async ({ query, limit = 100 }) => {
      try {
        const { client } = mooseUtils;

        let finalQuery = query.trim();

        // Tier 3: inject org_id filter into SELECT queries for data isolation
        if (userContext?.orgId) {
          const upperQuery = finalQuery.toUpperCase();
          if (upperQuery.startsWith("SELECT")) {
            const orgIdEscaped = userContext.orgId.replace(/'/g, "\\'");
            if (finalQuery.toUpperCase().includes("WHERE")) {
              finalQuery = finalQuery.replace(
                /WHERE/i,
                `WHERE org_id = '${orgIdEscaped}' AND`,
              );
            } else if (finalQuery.toUpperCase().includes("GROUP BY")) {
              finalQuery = finalQuery.replace(
                /GROUP BY/i,
                `WHERE org_id = '${orgIdEscaped}' GROUP BY`,
              );
            } else if (finalQuery.toUpperCase().includes("ORDER BY")) {
              finalQuery = finalQuery.replace(
                /ORDER BY/i,
                `WHERE org_id = '${orgIdEscaped}' ORDER BY`,
              );
            } else if (finalQuery.toUpperCase().includes("LIMIT")) {
              finalQuery = finalQuery.replace(
                /LIMIT/i,
                `WHERE org_id = '${orgIdEscaped}' LIMIT`,
              );
            } else {
              finalQuery += ` WHERE org_id = '${orgIdEscaped}'`;
            }
          }
        }

        const result = await clickhouseReadonlyQuery(client, finalQuery, limit);

        // Parse the JSON response from ClickHouse
        const data = await result.json();
        const rows = Array.isArray(data) ? data : [];

        const output = {
          rows,
          rowCount: rows.length,
        };

        // Audit logging when user context is present (Tier 2/3)
        if (userContext) {
          console.log(
            JSON.stringify({
              event: "tool_invocation",
              tool: "query_clickhouse",
              userId: userContext.userId,
              email: userContext.email,
              orgId: userContext.orgId,
              query: query.trim(),
              rowCount: rows.length,
              timestamp: new Date().toISOString(),
            }),
          );
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(output, null, 2),
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
              text: `Error executing query: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  /**
   * Register the get_data_catalog tool
   *
   * Allows AI to discover available tables, views, and materialized views
   * with their schema information.
   */
  server.tool(
    "get_data_catalog",
    "Discover available tables and materialized views in the ClickHouse database with their schema information. Use this to learn what data exists before writing queries.",
    {
      component_type: z
        .enum(["tables", "materialized_views"])
        .optional()
        .describe(
          "Filter by component type: 'tables' for regular tables, 'materialized_views' for pre-aggregated views",
        ),
      search: z
        .string()
        .optional()
        .describe("Regex pattern to search for in component names"),
      format: z
        .enum(["summary", "detailed"])
        .default("summary")
        .optional()
        .describe(
          "Output format: 'summary' shows names and column counts, 'detailed' shows full schemas",
        ),
    },
    {
      title: "Get Data Catalog",
    },
    async ({ component_type, search, format = "summary" }) => {
      try {
        const { client } = mooseUtils;

        // Get filtered list of tables and materialized views
        const { tables, materializedViews } =
          await getTablesAndMaterializedViews(client, component_type, search);

        // Format output based on requested format
        let output: string;
        if (format === "detailed") {
          output = await formatCatalogDetailed(
            client,
            tables,
            materializedViews,
          );
        } else {
          output = await formatCatalogSummary(
            client,
            tables,
            materializedViews,
          );
        }

        // Audit logging when user context is present (Tier 2/3)
        if (userContext) {
          console.log(
            JSON.stringify({
              event: "tool_invocation",
              tool: "get_data_catalog",
              userId: userContext.userId,
              email: userContext.email,
              orgId: userContext.orgId,
              component_type,
              search,
              format,
              timestamp: new Date().toISOString(),
            }),
          );
        }

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

  return server;
};

/**
 * MCP Transport Configuration
 *
 * Uses StreamableHTTPServerTransport in STATELESS mode with JSON responses.
 * - No session ID generation or tracking (sessionIdGenerator: undefined)
 * - JSON responses instead of Server-Sent Events (enableJsonResponse: true)
 * - Fresh server instance created for every request
 * - POST requests with JSON-RPC messages
 */

// Single endpoint that handles all MCP requests
app.all("/", async (req, res) => {
  try {
    console.log(`[MCP] Handling ${req.method} request (stateless mode)`);

    // Get MooseStack utilities (ClickHouse client and SQL helpers)
    const mooseUtils = await getMooseUtils();

    // Create a fresh transport and server for EVERY request (stateless)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode - no session management
      enableJsonResponse: true, // Use JSON responses instead of SSE
    });

    transport.onerror = (error: Error) => {
      console.error(`[MCP Error]`, error);
    };

    // Create a fresh MCP server instance for this request
    //
    // Why per-request instantiation?
    // - MCP transports and servers are completely decoupled
    // - Tools need access to request-specific mooseUtils (ClickHouse client, etc.)
    // - The only way to pass mooseUtils to tool handlers is via closure in serverFactory()
    // - Creating the server per-request ensures each request has isolated utilities
    //
    // Performance note: Server instantiation + tool registration is lightweight.
    // The overhead is minimal compared to database queries.
    const server = serverFactory(mooseUtils, (req as any).userContext);
    await server.connect(transport);

    // Handle the request
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("[MCP Error] Failed to handle request:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

/**
 * Export the WebApp instance
 *
 * This registers the Express app with MooseStack's routing system.
 * The mountPath "/tools" means this MCP server will be accessible at:
 * http://localhost:4000/tools
 *
 * Note: We use "/tools" instead of "/mcp" because MooseStack's built-in
 * MCP server already uses the /mcp endpoint.
 */
export const mcpServer = new WebApp("mcpServer", app, {
  mountPath: "/tools",
  metadata: {
    description:
      "MCP server exposing ClickHouse query tools via Express and WebApp",
  },
});
