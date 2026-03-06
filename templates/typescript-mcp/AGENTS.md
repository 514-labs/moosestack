# TypeScript MCP Template

pnpm monorepo: MooseStack backend (`packages/moosestack-service`) + Next.js chat frontend (`packages/web-app`).

Two MCP servers run on the same host:

- `/mcp` — MooseStack's built-in MCP server (for AI copilot dev assistance)
- `/tools` — This template's custom MCP server (for the chat UI and external clients)

## Pre-Development Steps

### 1. Check local environment

- Verify ports 3000, 4000, 5001, 7233, 8080, 9000, and 18123 are free. See `moose.config.toml` to change them if needed.
- The project must be initialized (`moose init`) and dependencies installed (`pnpm install`).

### 2. Clarify requirements with the user

Before building data models or tools, ask the user:

- What data they want to model (fields, sources, volume)
- How the data will be queried (what questions will users ask, what filters matter most)
- How the data will be consumed (chat interface, dashboards, API endpoints)
- Whether ingestion is real-time streaming or batch

The user knows their data and use case; use the ClickHouse Best Practices Skill to translate their requirements into optimal schemas, `orderByFields`, and queries.

### 3. Set up agent harness

Ensure all of these are active before starting work.

1. **Dev server running** — Start with `pnpm dev:moose`. This powers ClickHouse, the data pipeline, and the MooseDev MCP server.

2. **MooseDev MCP connected** — Pre-configured in `.mcp.json`. Verify it is connected in your copilot. This is your primary tool for inspecting the project.

3. **Context7 connected** — Pre-configured in `.mcp.json`. Add "use context7" to your prompts when you need MooseStack documentation.

4. **ClickHouse Best Practices Skill installed** — Install at the start of every session if not already present:

   ```bash
   npx skills add https://github.com/514-labs/agent-skills --skill moosestack-clickhouse-best-practices
   ```

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

MooseStack's core pattern: define a TypeScript interface once, then wire up individual primitives (`OlapTable`, `Stream`, `IngestApi`) to create your data pipeline.

```typescript
// app/ingest/models.ts
import { OlapTable, Stream, IngestApi } from "@514labs/moose-lib";

export interface PageView {
  viewId: string;
  timestamp: Date;
  url: string;
  userId: string;
  durationMs: number;
}

// ClickHouse table — orderByFields is critical for query performance
export const PageViewTable = new OlapTable<PageView>("PageView", {
  orderByFields: ["userId", "timestamp"],
});

// Streaming topic — wired to the table
export const PageViewStream = new Stream<PageView>("PageView", {
  destination: PageViewTable,
});

// REST API endpoint — POST /ingest/PageView
export const PageViewApi = new IngestApi<PageView>("PageView", {
  destination: PageViewStream,
});
```

Use `orderByFields` to control ClickHouse table ordering — put your most-filtered columns first. Use the ClickHouse Best Practices Skill to choose the right ordering for the user's query patterns.

For advanced table configuration (engines, indexes, projections), see `moose docs moosestack/olap/model-table`.

### Adding an API endpoint

This template uses Express (already set up in `app/apis/mcp.ts`). Add new endpoints to the existing Express app, or create a new `WebApp` for a separate mount path:

```typescript
// app/apis/analytics.ts
import express from "express";
import { WebApp, getMooseUtils } from "@514labs/moose-lib";

const app = express();
app.use(express.json());

app.get("/top-pages", async (req, res) => {
  const { client, sql } = await getMooseUtils();
  const userId = req.query.userId as string;
  const limit = parseInt(req.query.limit as string) || 10;

  try {
    const query = sql.statement`
      SELECT url, count() as totalViews
      FROM PageView
      WHERE userId = ${userId}
      GROUP BY url
      ORDER BY totalViews DESC
      LIMIT ${limit}
    `;
    const result = await client.query.execute(query);
    const data = await result.json();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export const analyticsApi = new WebApp("analytics", app, {
  mountPath: "/analytics", // Accessible at http://localhost:4000/analytics/top-pages
});
```

Key patterns:

- Use `getMooseUtils()` to get the ClickHouse `client` and type-safe `sql` template literal
- Use `sql.statement` for complete SQL queries and `sql.fragment` for reusable SQL expressions (prevents injection)
- Export the `WebApp` from the file — MooseStack discovers it automatically
- This template uses Express, but MooseStack also supports Fastify and FastAPI. See `moose docs moosestack/app-api-frameworks` for all options

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

- **DO** use `orderByFields` to define ClickHouse table ordering. **DON'T** rely on default ordering — always specify based on query patterns.
- **DO** use `currentDatabase()` in SQL queries. **DON'T** hardcode the database name.
- **DO** use `clickhouseReadonlyQuery()` for MCP tool DB access. **DON'T** use `client.query.client.query()` directly without readonly settings.
- **DO** use `OlapTable` + `Stream` + `IngestApi` for new data models. **DON'T** write raw CREATE TABLE DDL — MooseStack generates tables from your models.
- **DO** return user-friendly error messages in MCP tool responses. **DON'T** expose internal error details or stack traces.
- **DO** export new primitives from `app/index.ts`. **DON'T** forget to export — MooseStack won't discover unexported primitives.
- **DO** use the ClickHouse Best Practices Skill for schema decisions. **DON'T** guess at ClickHouse data types or engine choices.
- **DON'T** modify `packages/web-app/.env.development` — it is pre-configured for local dev.

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
