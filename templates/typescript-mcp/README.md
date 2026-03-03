# TypeScript MCP Template

This template provides a complete example of building AI-powered chat-over-data applications with MooseStack and the Model Context Protocol (MCP).

## Overview

This is a pnpm monorepo containing two independent applications that work together:

```
Next.js App (Chat UI -> API Route -> MCP Client)
    | HTTP + Bearer Token |
MooseStack Service (Tools -> MCP Server -> ClickHouse)
```

### 1. `packages/moosestack-service/`

A MooseStack service that provides a data pipeline with an integrated MCP server. This service:

- Provides a complete MooseStack data pipeline example
- Exposes an MCP server that AI agents can connect to
- Includes data ingestion, processing, and API capabilities
- Can be run independently for development and testing
- Built using [BYO API](https://docs.fiveonefour.com/moose/app-api-frameworks) and Express

### 2. `packages/web-app/`

A Next.js web application with a pre-configured AI chat interface. This application:

- Features a modern, responsive layout with an integrated chat panel
- Includes a fully functional AI chat interface out of the box
- Is configured to connect to the MooseStack service MCP server
- Provides a ready-to-use foundation for building AI-powered user experiences

## Prerequisites

- Node.js v20+ and pnpm v8+
- Docker Desktop (running)
- [Moose CLI](https://docs.fiveonefour.com/moose/getting-started/new-project)
- [Anthropic API key](https://console.anthropic.com/)
- Recommended: AI copilot (Claude Code, Cursor, or similar)

## Getting Started

Initiate your project:

```bash
moose init <project-name> typescript-mcp
cd <project-name>
```

Install dependencies for both applications:

```bash
pnpm install
```

Copy example environment variables:

```bash
cp packages/moosestack-service/.env.{example,local}
cp packages/web-app/.env.{example,local}
```

Create API Key authentication tokens:

```bash
cd packages/moosestack-service
moose generate hash-token # use output for the API Key & Token below
```

Set environment variables:

1. Set `MCP_API_KEY` in `packages/moosestack-service/.env.local` to the `ENV API Key` value from `moose generate hash-token`
2. Set `MCP_API_TOKEN` in `packages/web-app/.env.local` to the `Bearer Token` value from `moose generate hash-token`
3. Set `ANTHROPIC_API_KEY` in `packages/web-app/.env.local` to your [Anthropic API key](https://console.anthropic.com/)
4. `MCP_SERVER_URL` in `packages/web-app/.env.local` is pre-set to `http://localhost:4000` for local development

Start both services:

```bash
pnpm dev
```

Or start services individually:

```bash
pnpm dev:moose    # Start MooseStack service only
pnpm dev:web      # Start web app only
```

Access the application at `http://localhost:3000`. Click the chat icon in the bottom-right corner to open the chat panel.

### Local Development Ports

Make sure the following ports are free before running `pnpm dev`. If any are in use, you can change them in `packages/moosestack-service/moose.config.toml`.

| Service              | Port  |
| -------------------- | ----- |
| Next.js web app      | 3000  |
| MooseStack HTTP/MCP  | 4000  |
| Management API       | 5001  |
| Temporal             | 7233  |
| Temporal UI          | 8080  |
| ClickHouse HTTP      | 18123 |
| ClickHouse native    | 9000  |

### Optional: AI Copilot Integration

#### MooseDev MCP

MooseStack includes a built-in MCP server for development. Connect your AI copilot to it so it can query your local database and inspect your data pipeline:

```bash
claude mcp add --transport http moose-dev http://localhost:4000/mcp
```

You may need to restart your IDE or copilot after adding the MCP server. Validate the connection with the `/mcp` slash command in Claude Code.

#### Context7 for MooseStack Documentation

[Context7](https://github.com/upstash/context7) serves up-to-date MooseStack documentation directly to your copilot, improving code generation accuracy.

1. Install Context7 for your IDE following the [installation instructions](https://github.com/upstash/context7#installation)
2. Restart your copilot after installation
3. Add "use context7" to your prompts when referencing MooseStack documentation

## Next Steps

For a full walkthrough of data modeling, loading data, customizing the frontend, and deploying to production, see the [Chat in Your App Tutorial](https://docs.fiveonefour.com/guides/chat-in-your-app/tutorial).

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

## Setting Up MCP with Your Clients

You can configure MCP clients to connect to this custom MCP server:

### Set up MCP with Claude Code using the CLI

```bash
claude mcp add --transport http moose-tools http://localhost:4000/tools --header "Authorization: Bearer <your_bearer_token>"
```

### Set up MCP with other clients using mcp.json

Create or update your `mcp.json` configuration file:

```json
{
  "mcpServers": {
    "moose-tools": {
      "transport": "http",
      "url": "http://localhost:4000/tools",
      "headers": {
        "Authorization": "Bearer <your_bearer_token>"
      }
    }
  }
}
```

Replace `<your_bearer_token>` with the Bearer Token generated by `moose generate hash-token`.

Once connected, you can ask your MCP client questions like:

- "What tables exist in the database?"
- "Show me the latest 10 events from the DataEvent table"
- "How many events are in the DataEvent table?"

Your MCP client will automatically use the `query_clickhouse` tool to execute the appropriate SQL queries.

## Security Features

This template implements several security measures for safe database querying:

### Implemented

- **Readonly SQL Queries**: enforced by the ClickHouse client
- **Row Limiting**: Results are capped at a default of 100 rows, but this limit can be configured up to a maximum of 1000 rows to prevent excessive data transfer
- **Error Handling**: Security errors returned through MCP protocol without exposing internals

### Production Considerations

Before deploying to production, consider adding:

- **Rate Limiting**: Protect against abuse and DoS attacks
- **Query Timeouts**: Prevent long-running queries from consuming resources
- **Audit Logging**: Track who executed which queries and when
- **IP Whitelisting**: Restrict access to known clients
- **TLS/HTTPS**: Encrypt data in transit

## Extending This Template

### Adding More Tools

Register additional tools in `packages/moosestack-service/app/apis/mcp.ts` using `server.registerTool()`. Each tool needs a name, title, description, input/output schemas (using Zod), and an async handler function.

### Accessing MooseStack Utilities

Use `await getMooseUtils()` in your endpoint handlers to access the ClickHouse client (`client.query.execute()`) and SQL template function (`sql`) for safe query execution.

### Adding More Data Models

Create additional data models in `packages/moosestack-service/app/ingest/models.ts` by defining interfaces and creating OlapTable instances.

## Troubleshooting

### Port Already in Use

If port 4000 is already in use, update `packages/moosestack-service/moose.config.toml`:

```toml
[server]
port = 4001
```

### "MCP_SERVER_URL environment variable is not set"

Ensure `packages/web-app/.env.local` contains:

```
MCP_SERVER_URL=http://localhost:4000
```

### "Unauthorized" or 401 Errors

- Verify `MCP_API_KEY` in `packages/moosestack-service/.env.local` matches the hash from `moose generate hash-token`
- Confirm `MCP_API_TOKEN` in `packages/web-app/.env.local` is the Bearer Token (not the hash)
- Check Authorization headers in network requests

### CORS Errors

- Ensure the chat UI calls `/api/chat` (same-origin)
- Backend requests to MooseStack use server-side Bearer token

### Chat Panel Missing

- Check browser console for errors
- Verify `ChatLayoutWrapper` wraps the app in `layout.tsx`
- Confirm shadcn/ui components are installed

### "ANTHROPIC_API_KEY not set"

- Add your key to `packages/web-app/.env.local`
- Restart the Next.js dev server (env vars load on startup)

### TypeScript Errors

Make sure all dependencies are installed:

```bash
pnpm install
```

## How They Work Together

1. The **packages/moosestack-service** runs your data pipeline and exposes an MCP server that provides AI agents with access to your data and tools
2. The **packages/web-app** provides a user interface where users can interact with an AI agent
3. The AI agent in the web app connects to the MCP server to access your data and capabilities
4. Users can chat naturally with the AI, which uses the MCP server to answer questions and perform actions on your data

## Learn More

- [Chat in Your App Tutorial](https://docs.fiveonefour.com/guides/chat-in-your-app/tutorial)
- [MooseStack Documentation](https://docs.fiveonefour.com)
- [Model Context Protocol](https://modelcontextprotocol.io)
- [MCP SDK (@modelcontextprotocol/sdk)](https://github.com/modelcontextprotocol/typescript-sdk)
- [WebApp Class Reference](https://docs.fiveonefour.com/moose/app-api-frameworks)
