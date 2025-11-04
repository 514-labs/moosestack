# TypeScript MCP Template

This template demonstrates how to integrate the **Model Context Protocol (MCP)** with MooseStack using Express and the `WebApp` class. It showcases MooseStack's "bring your own API framework" capability.

## What is Model Context Protocol (MCP)?

[Model Context Protocol (MCP)](https://modelcontextprotocol.io) is an open protocol that enables AI assistants to securely connect to data sources and tools. It provides a standardized way for LLMs to:

- Access real-time data
- Execute operations
- Interact with external services
- Query databases and APIs

## What This Template Demonstrates

This template shows how to:

1. **Create custom API endpoints** using Express within MooseStack
2. **Implement an MCP server** using `@modelcontextprotocol/sdk`
3. **Mount custom web apps** at specific paths using the `WebApp` class
4. **Define data models** with ClickHouse table creation
5. **Expose tools** that AI assistants can use via MCP

## Key Components

### 1. Data Model (`app/ingest/models.ts`)

Defines a minimal `DataEvent` model with ClickHouse table creation. The IngestPipeline creates the ClickHouse table, enables Kafka streaming, and provides a POST endpoint at `/ingest/DataEvent`.

### 2. MCP Server (`app/apis/mcp.ts`)

Implements an MCP server using `@modelcontextprotocol/sdk`:

- Uses **StreamableHTTPServerTransport** with JSON responses (stateless mode)
- Registers a `query_clickhouse` tool for AI assistants
- Mounts at `/tools` to avoid conflict with built-in `/mcp` endpoint
- Accesses ClickHouse via `getMooseUtils()` for query execution
- Fresh server instance created for every request

**Security Features:**

- SQL query whitelist: Only SELECT, SHOW, DESCRIBE, EXPLAIN queries permitted
- SQL query blocklist: Prevents INSERT, UPDATE, DELETE, DROP, CREATE, ALTER, TRUNCATE, etc.
- Row limit enforcement: Results automatically capped at 100 rows maximum

### 3. SQL Security (`app/apis/utils/sql.ts`)

Provides SQL validation and sanitization utilities:

- `validateQuery()`: Main validation function combining whitelist and blocklist checks
- `validateQueryWhitelist()`: Ensures query starts with allowed SQL keywords
- `validateQueryBlocklist()`: Blocks dangerous SQL operations
- `applyLimitToQuery()`: Enforces maximum row limits on SELECT queries

Uses regex-based pattern matching for ClickHouse SQL validation without external parser dependencies.

## Getting Started

### 1. Install Dependencies

```bash
npm install
```

### 2. Start Development Server

```bash
moose dev
```

The MCP server will be available at `http://localhost:4000/tools`

### 3. Test the MCP Server

The MCP server will be available at `http://localhost:4000/tools`. You can test it by sending JSON-RPC requests to list available tools or execute the `query_clickhouse` tool.

## MCP Tools Available

### `query_clickhouse`

Executes SQL queries against the ClickHouse database with security validation and automatic result limiting.

**Input Parameters:**

- `query` (required): SQL query to execute against ClickHouse (must be SELECT, SHOW, DESCRIBE, or EXPLAIN)
- `limit` (optional): Maximum number of rows to return (default: 100, max: 100)

**Output:**

- `rows`: Array of row objects containing query results
- `rowCount`: Number of rows returned

**Security:**

- Only read-only queries are allowed (SELECT, SHOW, DESCRIBE, EXPLAIN)
- Write operations (INSERT, UPDATE, DELETE) are blocked
- DDL operations (DROP, CREATE, ALTER, TRUNCATE) are blocked
- Results are automatically limited to 100 rows maximum

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

```bash
npm install
```

### ClickHouse Connection Issues

Verify Docker containers are running:

```bash
docker ps
```

You should see containers for ClickHouse, Redpanda, and Temporal.

## Support

For questions or issues:

- [GitHub Issues](https://github.com/514-labs/moose)
- [Discord Community](https://discord.gg/moose)
- [Documentation](https://docs.moosejs.com)
