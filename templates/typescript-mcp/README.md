# TypeScript MCP Template

This template provides a complete example of building AI-powered applications with MooseStack and the Model Context Protocol (MCP).

## Overview

This template contains two independent applications that work together:

### 1. `moosestack-service/`

A MooseStack service template that demonstrates how to build a data service with an integrated MCP server. This service:

- Provides a complete MooseStack data pipeline example
- Exposes an MCP server that AI agents can connect to
- Includes data ingestion, processing, and API capabilities
- Can be run independently for development and testing

### 2. `web-app-with-ai-chat/`

A Next.js web application with a pre-configured AI chat interface. This application:

- Features a modern, responsive layout with an integrated chat panel
- Includes a fully functional AI chat interface out of the box
- Is configured to connect to the MooseStack service MCP server
- Provides a ready-to-use foundation for building AI-powered user experiences

## Getting Started

Both applications can be started independently:

### Start the MooseStack Service

```bash
cd moosestack-service
npm install
npm run dev
```

### Start the Next.js Web App

```bash
cd web-app-with-ai-chat
npm install
npm run dev
```

## MCP Tools Available

### `query_clickhouse`

Executes SQL queries against the ClickHouse database with security validation and automatic result limiting. The tool automatically uses the current database context via `currentDatabase()` function.

**Input Parameters:**

- `query` (required): SQL query to execute against ClickHouse (must be SELECT, SHOW, DESCRIBE, or EXPLAIN)
- `limit` (optional): Maximum number of rows to return (default: 100, max: 1000)

**Output:**

- `rows`: Array of row objects containing query results
- `rowCount`: Number of rows returned

**Security:**

- Only read-only queries are allowed (SELECT, SHOW, DESCRIBE, EXPLAIN)
- Write operations (INSERT, UPDATE, DELETE) are blocked
- DDL operations (DROP, CREATE, ALTER, TRUNCATE) are blocked
- Results are automatically limited to maximum 1000 rows
- Enforces ClickHouse readonly mode at database level

### `get_data_catalog`

Discovers available tables and materialized views in the ClickHouse database with their schema information. Useful for AI assistants to learn what data exists before writing queries.

**Input Parameters:**

- `component_type` (optional): Filter by component type - `"tables"` for regular tables or `"materialized_views"` for pre-aggregated views
- `search` (optional): Regex pattern to search for in component names
- `format` (optional): Output format - `"summary"` (default) shows names and column counts, `"detailed"` shows full schemas with column types

**Output:**

- `catalog`: Formatted catalog information showing tables/views with their columns

**Database Context:**

All tools use `currentDatabase()` to automatically query the active database context, eliminating the need for database name configuration.

## Using with Claude Code

You can configure Claude Code to connect to your MCP server by adding it to your Claude Code configuration:

```bash
claude mcp add --transport http clickhouse http://localhost:4000/tools
```

Once connected, you can ask Claude Code questions like:

- "What tables exist in the database?"
- "Show me the latest 10 events from the DataEvent table"
- "How many events are in the DataEvent table?"

Claude Code will automatically use the `query_clickhouse` tool to execute the appropriate SQL queries.

## Security Features

This template implements several security measures for safe database querying:

### ✅ Implemented

- **SQL Query Validation**: Whitelist/blocklist validation ensures only safe, read-only queries
  - Allowed: SELECT, SHOW, DESCRIBE, EXPLAIN
  - Blocked: INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, TRUNCATE, GRANT, REVOKE, EXECUTE, CALL
- **Row Limiting**: Results automatically capped at 100 rows to prevent excessive data transfer
- **Error Handling**: Security errors returned through MCP protocol without exposing internals

### ⚠️ Production Considerations

Before deploying to production, consider adding:

- **Authentication & Authorization**: JWT authentication framework is in place (see TODO in mcp.ts)
- **Rate Limiting**: Protect against abuse and DoS attacks
- **Query Timeouts**: Prevent long-running queries from consuming resources
- **Audit Logging**: Track who executed which queries and when
- **IP Whitelisting**: Restrict access to known clients
- **TLS/HTTPS**: Encrypt data in transit

The current implementation provides a secure foundation for read-only database access but should be enhanced with additional production-grade features based on your deployment requirements.

## Testing Data Ingestion

You can send test events to the DataEvent table via POST requests to `http://localhost:4000/ingest/DataEvent` with JSON payloads containing `eventId`, `timestamp`, `eventType`, and `data` fields.

## Extending This Template

### Adding More Tools

Register additional tools in `app/apis/mcp.ts` using `server.registerTool()`. Each tool needs a name, title, description, input/output schemas (using Zod), and an async handler function.

### Accessing MooseStack Utilities

Use `getMooseUtils(req)` in your endpoint handlers to access the ClickHouse client (`client.query.execute()`) and SQL template function (`sql`) for safe query execution.

### Adding More Data Models

Create additional data models in `app/ingest/models.ts` by defining interfaces and creating IngestPipeline instances with options for `table`, `stream`, and `ingestApi`.

## Learn More

- [MooseStack Documentation](https://docs.moosejs.com)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [MCP SDK (@modelcontextprotocol/sdk)](https://github.com/modelcontextprotocol/typescript-sdk)
- [WebApp Class Reference](https://docs.moosejs.com/building-moose-apps/custom-apis)

## Troubleshooting

### Port Already in Use

If port 4000 is already in use, update `moose.config.toml`:

```toml
[server]
port = 4001
```

### TypeScript Errors

Make sure all dependencies are installed:

## How They Work Together

1. The **moosestack-service** runs your data pipeline and exposes an MCP server that provides AI agents with access to your data and tools
2. The **web-app-with-ai-chat** provides a user interface where users can interact with an AI agent
3. The AI agent in the web app connects to the MCP server to access your data and capabilities
4. Users can chat naturally with the AI, which uses the MCP server to answer questions and perform actions on your data

## Next Steps

- Customize the MooseStack service with your own data models and APIs
- Extend the AI chat interface with additional features and integrations
- Configure the MCP connection settings to match your deployment environment

For more detailed information, see the README files in each subdirectory.
