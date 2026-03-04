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

Define an interface with a `Key<>` primary key and create an `IngestPipeline` in `app/ingest/models.ts`:

```typescript
import { IngestPipeline, Key } from "@514labs/moose-lib";

export interface PageView {
  viewId: Key<string>;
  timestamp: Date;
  url: string;
  userId: string;
  durationMs: number;
}

export const PageViewPipeline = new IngestPipeline<PageView>("PageView", {
  table: true, // Create ClickHouse table
  stream: true, // Enable streaming
  ingestApi: true, // POST /ingest/PageView
});
```

### Adding an MCP tool

Register tools in `app/apis/mcp.ts` inside the `serverFactory` function using `server.registerTool()`:

```typescript
server.registerTool(
  "tool_name",
  {
    title: "Human-readable title",
    description: "What this tool does — be specific, AI assistants read this.",
    inputSchema: {
      param: z.string().describe("What this parameter is for"),
    },
  },
  async ({ param }) => {
    const { client } = mooseUtils;
    // Use clickhouseReadonlyQuery(client, sql, limit) for DB queries
    return {
      content: [{ type: "text" as const, text: "result" }],
    };
  },
);
```

### Do / Don't

- **Do** use `currentDatabase()` in SQL — don't hardcode the database name
- **Do** use `clickhouseReadonlyQuery()` for all DB access in MCP tools — it enforces readonly mode
- **Do** use Zod schemas to validate ClickHouse query results
- **Don't** modify `packages/web-app/.env.development` — it's pre-configured for local dev
- **Don't** use write queries (INSERT, UPDATE, DELETE) or DDL (CREATE, ALTER, DROP) in MCP tools
- **Don't** expose internal error details in MCP tool responses — return user-friendly messages

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
