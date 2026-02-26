"use strict";
var __assign =
  (this && this.__assign) ||
  function () {
    __assign =
      Object.assign ||
      function (t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
          s = arguments[i];
          for (var p in s)
            if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
        }
        return t;
      };
    return __assign.apply(this, arguments);
  };
var __awaiter =
  (this && this.__awaiter) ||
  function (thisArg, _arguments, P, generator) {
    function adopt(value) {
      return value instanceof P ? value : (
          new P(function (resolve) {
            resolve(value);
          })
        );
    }
    return new (P || (P = Promise))(function (resolve, reject) {
      function fulfilled(value) {
        try {
          step(generator.next(value));
        } catch (e) {
          reject(e);
        }
      }
      function rejected(value) {
        try {
          step(generator["throw"](value));
        } catch (e) {
          reject(e);
        }
      }
      function step(result) {
        result.done ?
          resolve(result.value)
        : adopt(result.value).then(fulfilled, rejected);
      }
      step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
  };
var __generator =
  (this && this.__generator) ||
  function (thisArg, body) {
    var _ = {
        label: 0,
        sent: function () {
          if (t[0] & 1) throw t[1];
          return t[1];
        },
        trys: [],
        ops: [],
      },
      f,
      y,
      t,
      g = Object.create(
        (typeof Iterator === "function" ? Iterator : Object).prototype,
      );
    return (
      (g.next = verb(0)),
      (g["throw"] = verb(1)),
      (g["return"] = verb(2)),
      typeof Symbol === "function" &&
        (g[Symbol.iterator] = function () {
          return this;
        }),
      g
    );
    function verb(n) {
      return function (v) {
        return step([n, v]);
      };
    }
    function step(op) {
      if (f) throw new TypeError("Generator is already executing.");
      while ((g && ((g = 0), op[0] && (_ = 0)), _))
        try {
          if (
            ((f = 1),
            y &&
              (t =
                op[0] & 2 ? y["return"]
                : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0)
                : y.next) &&
              !(t = t.call(y, op[1])).done)
          )
            return t;
          if (((y = 0), t)) op = [op[0] & 2, t.value];
          switch (op[0]) {
            case 0:
            case 1:
              t = op;
              break;
            case 4:
              _.label++;
              return { value: op[1], done: false };
            case 5:
              _.label++;
              y = op[1];
              op = [0];
              continue;
            case 7:
              op = _.ops.pop();
              _.trys.pop();
              continue;
            default:
              if (
                !((t = _.trys), (t = t.length > 0 && t[t.length - 1])) &&
                (op[0] === 6 || op[0] === 2)
              ) {
                _ = 0;
                continue;
              }
              if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) {
                _.label = op[1];
                break;
              }
              if (op[0] === 6 && _.label < t[1]) {
                _.label = t[1];
                t = op;
                break;
              }
              if (t && _.label < t[2]) {
                _.label = t[2];
                _.ops.push(op);
                break;
              }
              if (t[2]) _.ops.pop();
              _.trys.pop();
              continue;
          }
          op = body.call(thisArg, _);
        } catch (e) {
          op = [6, e];
          y = 0;
        } finally {
          f = t = 0;
        }
      if (op[0] & 5) throw op[1];
      return { value: op[0] ? op[1] : void 0, done: true };
    }
  };
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, "__esModule", { value: true });
exports.mcpServer = exports.serverFactory = void 0;
exports.clickhouseReadonlyQuery = clickhouseReadonlyQuery;
exports.isJwt = isJwt;
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
var express_1 = __importDefault(require("express"));
var mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
var streamableHttp_js_1 = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
var v3_1 = require("zod/v3");
var moose_lib_1 = require("@514labs/moose-lib");
var express_pbkdf2_api_key_auth_1 = require("@514labs/express-pbkdf2-api-key-auth");
var jose_1 = require("jose");
var express_rate_limit_1 = __importDefault(require("express-rate-limit"));
function clickhouseReadonlyQuery(client, sql, limit, queryParams) {
  if (limit === void 0) {
    limit = 100;
  }
  return client.query.client.query(
    __assign(
      {
        query: sql,
        format: "JSONEachRow",
        clickhouse_settings: {
          readonly: "2",
          limit: limit.toString(),
        },
      },
      queryParams && { query_params: queryParams },
    ),
  );
}
/**
 * Query ClickHouse to get column information for a specific table.
 * Uses currentDatabase() to automatically query the active database context.
 */
function getTableColumns(client, tableName) {
  return __awaiter(this, void 0, void 0, function () {
    var query, result, rawData, data;
    return __generator(this, function (_a) {
      switch (_a.label) {
        case 0:
          query =
            "\n    SELECT\n      name,\n      type,\n      type LIKE '%Nullable%' as nullable,\n      comment\n    FROM system.columns\n    WHERE database = currentDatabase() AND table = {tableName:String}\n    ORDER BY position\n  ";
          return [
            4 /*yield*/,
            clickhouseReadonlyQuery(client, query, 10000, {
              tableName: tableName,
            }),
          ];
        case 1:
          result = _a.sent();
          return [4 /*yield*/, result.json()];
        case 2:
          rawData = _a.sent();
          data = v3_1.z.array(ColumnQueryResultSchema).parse(rawData);
          return [
            2 /*return*/,
            data.map(function (row) {
              return {
                name: row.name,
                type: row.type,
                nullable: row.nullable === 1,
                comment: row.comment || undefined,
              };
            }),
          ];
      }
    });
  });
}
// Zod schemas for runtime validation of ClickHouse query results
var ColumnQueryResultSchema = v3_1.z.object({
  name: v3_1.z.string(),
  type: v3_1.z.string(),
  nullable: v3_1.z.number(),
  comment: v3_1.z.string(),
});
var TableQueryResultSchema = v3_1.z.object({
  name: v3_1.z.string(),
  engine: v3_1.z.string(),
  component_type: v3_1.z.string(),
});
/**
 * Query ClickHouse to get list of tables and materialized views in the configured database.
 * Uses currentDatabase() to automatically query the active database context.
 */
function getTablesAndMaterializedViews(client, componentType, searchPattern) {
  return __awaiter(this, void 0, void 0, function () {
    var query,
      result,
      rawData,
      data,
      filteredData,
      pattern_1,
      tables,
      materializedViews;
    return __generator(this, function (_a) {
      switch (_a.label) {
        case 0:
          query =
            "\n    SELECT\n      name,\n      engine,\n      CASE\n        WHEN engine = 'MaterializedView' THEN 'materialized_view'\n        ELSE 'table'\n      END as component_type\n    FROM system.tables\n    WHERE database = currentDatabase()\n    ORDER BY name\n  ";
          return [4 /*yield*/, clickhouseReadonlyQuery(client, query, 10000)];
        case 1:
          result = _a.sent();
          return [4 /*yield*/, result.json()];
        case 2:
          rawData = _a.sent();
          data = v3_1.z.array(TableQueryResultSchema).parse(rawData);
          filteredData = data;
          // Apply component type filter
          if (componentType) {
            filteredData = filteredData.filter(function (row) {
              if (componentType === "tables")
                return row.component_type === "table";
              if (componentType === "materialized_views")
                return row.component_type === "materialized_view";
              return true;
            });
          }
          // Apply search pattern filter (case-insensitive substring match)
          if (searchPattern) {
            pattern_1 = searchPattern.toLowerCase();
            filteredData = filteredData.filter(function (row) {
              return row.name.toLowerCase().includes(pattern_1);
            });
          }
          tables = filteredData
            .filter(function (row) {
              return row.component_type === "table";
            })
            .map(function (row) {
              return { name: row.name, engine: row.engine };
            });
          materializedViews = filteredData
            .filter(function (row) {
              return row.component_type === "materialized_view";
            })
            .map(function (row) {
              return { name: row.name, engine: row.engine };
            });
          return [
            2 /*return*/,
            { tables: tables, materializedViews: materializedViews },
          ];
      }
    });
  });
}
/**
 * Format catalog as summary (just names and column counts)
 */
function formatCatalogSummary(client, tables, materializedViews) {
  return __awaiter(this, void 0, void 0, function () {
    var output,
      _i,
      tables_1,
      table,
      columns,
      _a,
      materializedViews_1,
      mv,
      columns;
    return __generator(this, function (_b) {
      switch (_b.label) {
        case 0:
          output = "# Data Catalog (Summary)\n\n";
          if (!(tables.length > 0)) return [3 /*break*/, 5];
          output += "## Tables (".concat(tables.length, ")\n");
          ((_i = 0), (tables_1 = tables));
          _b.label = 1;
        case 1:
          if (!(_i < tables_1.length)) return [3 /*break*/, 4];
          table = tables_1[_i];
          return [4 /*yield*/, getTableColumns(client, table.name)];
        case 2:
          columns = _b.sent();
          output += "- "
            .concat(table.name, " (")
            .concat(columns.length, " columns)\n");
          _b.label = 3;
        case 3:
          _i++;
          return [3 /*break*/, 1];
        case 4:
          output += "\n";
          _b.label = 5;
        case 5:
          if (!(materializedViews.length > 0)) return [3 /*break*/, 10];
          output += "## Materialized Views (".concat(
            materializedViews.length,
            ")\n",
          );
          ((_a = 0), (materializedViews_1 = materializedViews));
          _b.label = 6;
        case 6:
          if (!(_a < materializedViews_1.length)) return [3 /*break*/, 9];
          mv = materializedViews_1[_a];
          return [4 /*yield*/, getTableColumns(client, mv.name)];
        case 7:
          columns = _b.sent();
          output += "- "
            .concat(mv.name, " (")
            .concat(columns.length, " columns)\n");
          _b.label = 8;
        case 8:
          _a++;
          return [3 /*break*/, 6];
        case 9:
          output += "\n";
          _b.label = 10;
        case 10:
          if (tables.length === 0 && materializedViews.length === 0) {
            output = "No data components found matching the specified filters.";
          }
          return [2 /*return*/, output];
      }
    });
  });
}
/**
 * Format catalog as detailed JSON with full schema information
 */
function formatCatalogDetailed(client, tables, materializedViews) {
  return __awaiter(this, void 0, void 0, function () {
    var catalog,
      _i,
      tables_2,
      table,
      columns,
      _a,
      materializedViews_2,
      mv,
      columns;
    return __generator(this, function (_b) {
      switch (_b.label) {
        case 0:
          catalog = {};
          if (!(tables.length > 0)) return [3 /*break*/, 4];
          catalog.tables = {};
          ((_i = 0), (tables_2 = tables));
          _b.label = 1;
        case 1:
          if (!(_i < tables_2.length)) return [3 /*break*/, 4];
          table = tables_2[_i];
          return [4 /*yield*/, getTableColumns(client, table.name)];
        case 2:
          columns = _b.sent();
          catalog.tables[table.name] = {
            name: table.name,
            engine: table.engine,
            columns: columns,
          };
          _b.label = 3;
        case 3:
          _i++;
          return [3 /*break*/, 1];
        case 4:
          if (!(materializedViews.length > 0)) return [3 /*break*/, 8];
          catalog.materialized_views = {};
          ((_a = 0), (materializedViews_2 = materializedViews));
          _b.label = 5;
        case 5:
          if (!(_a < materializedViews_2.length)) return [3 /*break*/, 8];
          mv = materializedViews_2[_a];
          return [4 /*yield*/, getTableColumns(client, mv.name)];
        case 6:
          columns = _b.sent();
          catalog.materialized_views[mv.name] = {
            name: mv.name,
            engine: mv.engine,
            columns: columns,
          };
          _b.label = 7;
        case 7:
          _a++;
          return [3 /*break*/, 5];
        case 8:
          return [2 /*return*/, JSON.stringify(catalog, null, 2)];
      }
    });
  });
}
// Create Express application
var app = (0, express_1.default)();
app.use(express_1.default.json());
// Dual-mode auth: auto-detects PBKDF2 API key vs JWT from token format.
// - Token with 3 dot-separated segments → JWT path (Tier 2/3)
// - Otherwise → PBKDF2 path (Tier 1)
// - No token + no auth configured → dev mode (allow, no context)
var mcpApiKey = process.env.MCP_API_KEY;
var jwksUrl = process.env.JWKS_URL;
var jwtIssuer = process.env.JWT_ISSUER;
// Lazy-init JWKS keyset on first JWT request
var jwks;
function getJwks() {
  if (!jwks && jwksUrl) {
    jwks = (0, jose_1.createRemoteJWKSet)(new URL(jwksUrl));
  }
  return jwks;
}
function isJwt(token) {
  return token.split(".").length === 3;
}
var pbkdf2Middleware =
  mcpApiKey ?
    (0, express_pbkdf2_api_key_auth_1.createAuthMiddleware)(function () {
      return mcpApiKey;
    })
  : undefined;
// Rate limit: 300 requests per minute per IP.
// Chat conversations trigger multiple MCP tool calls per message (up to 25 steps),
// so the limit is generous enough for normal use but stops abuse.
app.use(
  (0, express_rate_limit_1.default)({
    windowMs: 60000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
app.use(function (req, res, next) {
  return __awaiter(void 0, void 0, void 0, function () {
    var authHeader, token, keyset, payload, userContext, error_1;
    var _a, _b, _c;
    return __generator(this, function (_d) {
      switch (_d.label) {
        case 0:
          authHeader = req.headers.authorization;
          token =
            (
              authHeader === null || authHeader === void 0 ?
                void 0
              : authHeader.startsWith("Bearer ")
            ) ?
              authHeader.slice(7)
            : undefined;
          if (!token) {
            // No token: if any auth is configured, reject; otherwise dev mode
            if (mcpApiKey || jwksUrl) {
              res.status(401).json({ error: "Missing authorization token" });
              return [2 /*return*/];
            }
            req.userContext = undefined;
            next();
            return [2 /*return*/];
          }
          if (!(isJwt(token) && jwksUrl)) return [3 /*break*/, 5];
          _d.label = 1;
        case 1:
          _d.trys.push([1, 3, , 4]);
          keyset = getJwks();
          if (!keyset) {
            res.status(500).json({ error: "JWKS not configured" });
            return [2 /*return*/];
          }
          return [
            4 /*yield*/,
            (0, jose_1.jwtVerify)(
              token,
              keyset,
              __assign({}, jwtIssuer && { issuer: jwtIssuer }),
            ),
          ];
        case 2:
          payload = _d.sent().payload;
          userContext = {
            userId:
              (_a = payload.sub) !== null && _a !== void 0 ? _a : "unknown",
            email:
              (_b = payload.email) !== null && _b !== void 0 ? _b : undefined,
            name:
              (_c = payload.name) !== null && _c !== void 0 ? _c : undefined,
            orgId: payload.org_id || undefined,
          };
          req.userContext = userContext;
          next();
          return [3 /*break*/, 4];
        case 3:
          error_1 = _d.sent();
          console.error("[MCP Auth] JWT validation failed:", error_1);
          res.status(401).json({ error: "Invalid JWT" });
          return [3 /*break*/, 4];
        case 4:
          return [3 /*break*/, 6];
        case 5:
          if (pbkdf2Middleware) {
            // PBKDF2 path (Tier 1)
            req.userContext = undefined;
            pbkdf2Middleware(req, res, next);
          } else if (mcpApiKey || jwksUrl) {
            // Auth is configured but token didn't match any path — reject
            res.status(401).json({ error: "Invalid authorization token" });
          } else {
            // Dev mode: no auth configured
            req.userContext = undefined;
            next();
          }
          _d.label = 6;
        case 6:
          return [2 /*return*/];
      }
    });
  });
});
/**
 * Server factory function that creates a fresh McpServer instance for each request.
 * This is required for stateless mode where each request is fully independent.
 * The mooseUtils parameter provides access to ClickHouse client and SQL helpers.
 */
var serverFactory = function (mooseUtils, userContext) {
  var server = new mcp_js_1.McpServer({
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
      query: v3_1.z
        .string()
        .describe("SQL query to execute against ClickHouse"),
      limit: v3_1.z
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
    function (_a) {
      return __awaiter(void 0, [_a], void 0, function (_b) {
        var client,
          finalQuery,
          scopeParams,
          upperQuery,
          result,
          data,
          rows,
          output,
          error_2,
          errorMessage;
        var query = _b.query,
          _c = _b.limit,
          limit = _c === void 0 ? 100 : _c;
        return __generator(this, function (_d) {
          switch (_d.label) {
            case 0:
              _d.trys.push([0, 3, , 4]);
              client = mooseUtils.client;
              finalQuery = query.trim();
              scopeParams = void 0;
              if (
                userContext === null || userContext === void 0 ?
                  void 0
                : userContext.orgId
              ) {
                upperQuery = finalQuery.toUpperCase();
                if (
                  upperQuery.startsWith("SELECT") ||
                  upperQuery.startsWith("WITH")
                ) {
                  finalQuery = "SELECT * FROM (".concat(
                    finalQuery,
                    ") AS _scoped WHERE org_id = {_scope_org_id:String}",
                  );
                  scopeParams = { _scope_org_id: userContext.orgId };
                }
              }
              return [
                4 /*yield*/,
                clickhouseReadonlyQuery(client, finalQuery, limit, scopeParams),
              ];
            case 1:
              result = _d.sent();
              return [4 /*yield*/, result.json()];
            case 2:
              data = _d.sent();
              rows = Array.isArray(data) ? data : [];
              output = {
                rows: rows,
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
              return [
                2 /*return*/,
                {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify(output, null, 2),
                    },
                  ],
                },
              ];
            case 3:
              error_2 = _d.sent();
              errorMessage =
                error_2 instanceof Error ? error_2.message : String(error_2);
              return [
                2 /*return*/,
                {
                  content: [
                    {
                      type: "text",
                      text: "Error executing query: ".concat(errorMessage),
                    },
                  ],
                  isError: true,
                },
              ];
            case 4:
              return [2 /*return*/];
          }
        });
      });
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
      component_type: v3_1.z
        .enum(["tables", "materialized_views"])
        .optional()
        .describe(
          "Filter by component type: 'tables' for regular tables, 'materialized_views' for pre-aggregated views",
        ),
      search: v3_1.z
        .string()
        .optional()
        .describe(
          "Substring to search for in component names (case-insensitive)",
        ),
      format: v3_1.z
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
    function (_a) {
      return __awaiter(void 0, [_a], void 0, function (_b) {
        var client,
          _c,
          tables,
          materializedViews,
          output,
          error_3,
          errorMessage;
        var component_type = _b.component_type,
          search = _b.search,
          _d = _b.format,
          format = _d === void 0 ? "summary" : _d;
        return __generator(this, function (_e) {
          switch (_e.label) {
            case 0:
              _e.trys.push([0, 6, , 7]);
              client = mooseUtils.client;
              return [
                4 /*yield*/,
                getTablesAndMaterializedViews(client, component_type, search),
              ];
            case 1:
              ((_c = _e.sent()),
                (tables = _c.tables),
                (materializedViews = _c.materializedViews));
              output = void 0;
              if (!(format === "detailed")) return [3 /*break*/, 3];
              return [
                4 /*yield*/,
                formatCatalogDetailed(client, tables, materializedViews),
              ];
            case 2:
              output = _e.sent();
              return [3 /*break*/, 5];
            case 3:
              return [
                4 /*yield*/,
                formatCatalogSummary(client, tables, materializedViews),
              ];
            case 4:
              output = _e.sent();
              _e.label = 5;
            case 5:
              // Audit logging when user context is present (Tier 2/3)
              if (userContext) {
                console.log(
                  JSON.stringify({
                    event: "tool_invocation",
                    tool: "get_data_catalog",
                    userId: userContext.userId,
                    email: userContext.email,
                    orgId: userContext.orgId,
                    component_type: component_type,
                    search: search,
                    format: format,
                    timestamp: new Date().toISOString(),
                  }),
                );
              }
              return [
                2 /*return*/,
                {
                  content: [
                    {
                      type: "text",
                      text: output,
                    },
                  ],
                },
              ];
            case 6:
              error_3 = _e.sent();
              errorMessage =
                error_3 instanceof Error ? error_3.message : String(error_3);
              return [
                2 /*return*/,
                {
                  content: [
                    {
                      type: "text",
                      text: "Error retrieving data catalog: ".concat(
                        errorMessage,
                      ),
                    },
                  ],
                  isError: true,
                },
              ];
            case 7:
              return [2 /*return*/];
          }
        });
      });
    },
  );
  return server;
};
exports.serverFactory = serverFactory;
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
app.all("/", function (req, res) {
  return __awaiter(void 0, void 0, void 0, function () {
    var mooseUtils, transport, server, error_4;
    return __generator(this, function (_a) {
      switch (_a.label) {
        case 0:
          _a.trys.push([0, 4, , 5]);
          console.log(
            "[MCP] Handling ".concat(req.method, " request (stateless mode)"),
          );
          return [4 /*yield*/, (0, moose_lib_1.getMooseUtils)()];
        case 1:
          mooseUtils = _a.sent();
          transport = new streamableHttp_js_1.StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // Stateless mode - no session management
            enableJsonResponse: true, // Use JSON responses instead of SSE
          });
          transport.onerror = function (error) {
            console.error("[MCP Error]", error);
          };
          server = (0, exports.serverFactory)(mooseUtils, req.userContext);
          return [4 /*yield*/, server.connect(transport)];
        case 2:
          _a.sent();
          // Handle the request
          return [4 /*yield*/, transport.handleRequest(req, res, req.body)];
        case 3:
          // Handle the request
          _a.sent();
          return [3 /*break*/, 5];
        case 4:
          error_4 = _a.sent();
          console.error("[MCP Error] Failed to handle request:", error_4);
          if (!res.headersSent) {
            res.status(500).json({ error: "Internal server error" });
          }
          return [3 /*break*/, 5];
        case 5:
          return [2 /*return*/];
      }
    });
  });
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
exports.mcpServer = new moose_lib_1.WebApp("mcpServer", app, {
  mountPath: "/tools",
  metadata: {
    description:
      "MCP server exposing ClickHouse query tools via Express and WebApp",
  },
});
//# sourceMappingURL=mcp.js.map
