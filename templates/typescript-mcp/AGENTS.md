# TypeScript MCP Template

pnpm monorepo: MooseStack backend (`packages/moosestack-service`) + Next.js chat frontend (`packages/web-app`).

Two MCP servers run on the same host:

- `/mcp` — MooseStack's built-in MCP server (for AI copilot dev assistance)
- `/tools` — This template's custom MCP server (for the chat UI and external clients)

## Agent Harness — Set Up Before Working

Ensure all of these are active before starting work on this project.

1. **Dev server running** — The project must be initialized (`moose init`) and the dev server started (`pnpm dev:moose`). This powers ClickHouse, the data pipeline, and the MooseDev MCP server.

2. **MooseDev MCP connected** — Pre-configured in `.mcp.json`. Verify it is connected in your copilot. This is your primary tool for inspecting the project.

3. **Context7 connected** — Pre-configured in `.mcp.json`. Add "use context7" to your prompts when you need MooseStack documentation.

4. **ClickHouse Best Practices Skill installed** — Install at the start of every session if not already present:

   ```bash
   npx skills add https://github.com/514-labs/agent-skills --skill moosestack-clickhouse-best-practices
   ```

5. **Clarify with the user** before building data models or tools:
   - What data they want to model (fields, sources, volume)
   - How it will be queried (dashboards, chat, API endpoints)
   - Whether ingestion is real-time streaming or batch

   The user knows their data and use case; use the ClickHouse Best Practices Skill to translate their requirements into optimal schemas and queries.

## Key Files

### `packages/moosestack-service/`

| File | Purpose | Docs |
| --- | --- | --- |
| `app/apis/mcp.ts` | Custom MCP server (tools, auth middleware, `/tools` endpoint) | [BYO API with Express](https://docs.fiveonefour.com/moosestack/app-api-frameworks/express) |
| `app/ingest/models.ts` | Data models (interfaces + IngestPipeline declarations) | [Data Modeling](https://docs.fiveonefour.com/moosestack/data-modeling) |
| `moose.config.toml` | Port and service configuration | |

### `packages/web-app/`

| File | Purpose |
| --- | --- |
| `src/features/chat/system-prompt.ts` | AI system prompt — customize this for your data |
| `src/features/chat/agent-config.ts` | MCP client setup (model, tools, transport) |
| `src/app/api/chat/route.ts` | Chat API endpoint |
| `.env.development` | Default local dev config (`MCP_SERVER_URL=http://localhost:4000`) |

## Common Tasks

### Adding a data model

MooseStack's core pattern: define a TypeScript interface once, and `IngestPipeline` automatically creates a REST API, streaming topic, and ClickHouse table from it.

Use `Key<T>` to mark the primary key field — the framework uses this for ClickHouse table ordering.

```typescript
// app/ingest/models.ts
import { IngestPipeline, Key } from "@514labs/moose-lib";

export interface PageView {
  viewId: Key<string>; // Primary key — must use Key<T>
  timestamp: Date;
  url: string;
  userId: string;
  durationMs: number;
}

export const PageViewPipeline = new IngestPipeline<PageView>("PageView", {
  table: true, // Creates ClickHouse table
  stream: true, // Creates streaming topic
  ingestApi: true, // Creates POST /ingest/PageView
});
```

This single declaration gives you:

- `POST /ingest/PageView` — type-validated REST endpoint
- A Redpanda/Kafka topic for real-time streaming
- A ClickHouse table with schema derived from the interface

For advanced table configuration (custom engines, ordering, indexes), pass an object to `table` instead of `true`. See `moose docs moosestack/olap/model-table`.

### Adding an MCP tool

Register tools in `app/apis/mcp.ts` inside the `serverFactory` function. Tools get access to `mooseUtils` (ClickHouse client) via closure:

```typescript
// Inside serverFactory(mooseUtils)
server.registerTool(
  "tool_name",
  {
    title: "Human-readable title",
    description: "Be specific — AI assistants read this to decide when to use the tool.",
    inputSchema: {
      param: z.string().describe("What this parameter is for"),
    },
  },
  async ({ param }) => {
    const { client } = mooseUtils;
    const result = await clickhouseReadonlyQuery(client, `SELECT ...`, 100);
    const data = await result.json();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
  },
);
```

Key patterns from this template:

- Use `clickhouseReadonlyQuery(client, sql, limit)` for all DB access — it sets `readonly: "2"` on the ClickHouse connection
- Use `currentDatabase()` in SQL instead of hardcoding the database name
- Validate ClickHouse results with Zod schemas (see `ColumnQueryResultSchema` in `mcp.ts`)
- Return errors via `{ content: [...], isError: true }`, not by throwing

### Do / Don't

| Do | Don't |
| --- | --- |
| Use `Key<T>` for primary keys in data models | Use plain `string` or `number` as primary keys |
| Use `currentDatabase()` in SQL queries | Hardcode the database name |
| Use `clickhouseReadonlyQuery()` for MCP tool DB access | Use `client.query.client.query()` directly without readonly settings |
| Use `IngestPipeline` with `table: true` for new data models | Create ClickHouse tables manually with DDL |
| Return user-friendly error messages in MCP tool responses | Expose internal error details or stack traces |
| Export new primitives from `app/index.ts` | Forget to export — MooseStack won't discover unexported primitives |
| Use the ClickHouse Best Practices Skill for schema decisions | Guess at ClickHouse data types or engine choices |

Do not modify `packages/web-app/.env.development` — it is pre-configured for local dev.

## Available Tools

### MooseDev MCP (live project inspection)

Prefer these over CLI commands — they return structured, token-optimized output.

| Tool | When to use |
| --- | --- |
| `get_infra_map` | **Start here.** Understand project topology (tables, streams, APIs, workflows) and data flow |
| `query_olap` | Explore data, verify ingestion, check schemas (read-only SQL) |
| `get_logs` | Debug errors, connection issues, or unexpected behavior |
| `get_issues` | Diagnose infrastructure health (stuck mutations, replication errors) |
| `get_stream_sample` | Inspect recent messages from streaming topics to verify data flow |

### Custom MCP tools (template's `/tools` endpoint)

These are the tools exposed to the chat UI and external MCP clients. Edit them in `app/apis/mcp.ts`.

| Tool | What it does | Parameters |
| --- | --- | --- |
| `query_clickhouse` | Read-only SQL (SELECT, SHOW, DESCRIBE, EXPLAIN). Blocks writes and DDL. Uses `currentDatabase()` automatically. | `query` (required), `limit` (optional, default 100, max 1000) |
| `get_data_catalog` | Discover tables and materialized views with schema info. Uses `currentDatabase()` automatically. | `component_type` (tables/materialized_views), `search` (regex), `format` (summary/detailed) |

### ClickHouse Best Practices Skill

Use when creating or refining data models, writing ClickHouse queries, designing schemas, or configuring materialized views. Contains rules for schema design, query optimization, insert strategy, and MooseStack-specific patterns.

### Moose CLI

Use `moose --help` to discover all commands. Most useful for getting context:

| Command | Purpose |
| --- | --- |
| `moose docs <slug>` | Fetch documentation (e.g., `moose docs moosestack/olap`) |
| `moose docs search "query"` | Search documentation by keyword |
| `moose query "SQL"` | Execute SQL directly against ClickHouse |
| `moose ls` | List all project primitives (tables, streams, APIs, workflows) |
| `moose peek <name>` | View sample data from a table or stream |
| `moose logs` | View dev server logs (use `-f "error"` to filter) |

## Environment Variables

`moose generate hash-token` outputs a key pair — the hash goes to the backend and the token goes to the frontend:

| Variable | File | Value |
| --- | --- | --- |
| `MCP_API_KEY` | `packages/moosestack-service/.env.local` | `ENV API Key` (hash) |
| `MCP_API_TOKEN` | `packages/web-app/.env.local` | `Bearer Token` |
| `ANTHROPIC_API_KEY` | `packages/web-app/.env.local` | Anthropic API key |
| `MCP_SERVER_URL` | `packages/web-app/.env.development` | Pre-set to `http://localhost:4000` |

## Documentation

- [Chat in Your App Tutorial](https://docs.fiveonefour.com/guides/chat-in-your-app/tutorial)
- [Data Modeling](https://docs.fiveonefour.com/moosestack/data-modeling)
- [OlapTable](https://docs.fiveonefour.com/moosestack/olap/model-table)
- [BYO API Frameworks](https://docs.fiveonefour.com/moosestack/app-api-frameworks)
- [Express Integration](https://docs.fiveonefour.com/moosestack/app-api-frameworks/express)
- [MooseDev MCP](https://docs.fiveonefour.com/moosestack/moosedev-mcp)
- [Semantic Layer / MCP Tools](https://docs.fiveonefour.com/moosestack/apis/semantic-layer)
- [Data Types](https://docs.fiveonefour.com/moosestack/data-types)
