# TypeScript Agent Template

pnpm monorepo: MooseStack backend (`packages/moosestack-service`) + Next.js chat frontend (`packages/web-app`).

Two MCP servers run on the same host:

- `/mcp` — MooseStack's built-in MCP server (for AI copilot dev assistance)
- `/tools` — This template's custom MCP server (for the chat UI and external clients)

This starter is opinionated for production-shaped agent work:

- OIDC-compatible auth with a local tenant picker in development
- JWT-backed tenant isolation on `tenant_id`
- Moose-owned dashboard APIs backed by query-layer models
- Shared agent runtime in `packages/agent-runtime`
- Shared Langfuse collector in `packages/agent-observability-langfuse`
- Langfuse-compatible tracing emitted from the web app
- AI Elements primitives for the generic chat shell, with Moose-specific wrappers in `src/features/chat/`
- Biome at the template root for formatting and baseline linting
- Turbo at the template root for dependency-ordered workspace builds
- Vitest at the template root for source-first unit and integration tests

## Pre-Development Steps

### 1. Check local environment

- Verify ports 3000, 4000, 5001, 7233, 8080, 9000, and 18123 are free. See `packages/moosestack-service/moose.config.toml` to change them if needed.
- The project must be initialized (`moose init`) and dependencies installed (`pnpm install`).
- Use `pnpm build`, `pnpm build:service`, `pnpm test`, `pnpm lint`, and `pnpm format` from the template root before handing work back.

### 2. Clarify requirements with the user

Before building data models or tools, ask the user:

- What data they want to model (fields, sources, volume)
- How the data will be queried (what questions will users ask, what filters matter most)
- How the data will be consumed (chat interface, dashboards, API endpoints)
- Whether ingestion is real-time streaming or batch

The user knows their data and use case; if the ClickHouse Best Practices Skill is installed, use it to translate their requirements into optimal schemas, `orderByFields`, and queries.

### 3. Agent tools available

1. **Dev server** — Prefer `pnpm dev:start` from the template root. It runs the workspace build, prepares local env files, validates Docker or Finch, waits for Moose readiness, and then starts the web app. Use `pnpm dev:moose` / `pnpm dev:web` separately only when you need split terminals.

2. **MooseDev MCP** — Primary tool for inspecting the project (see Available Tools below).

3. **Context7** — "use context7" to your prompts for MooseStack documentation.

4. **MooseStack and ClickHouse Best Practices Skills** — Contains rules for schema design, query optimization, insert strategy, and MooseStack-specific patterns.

## Package Guides

Every workspace package has a package-local `AGENTS.md`. Start with the guide for the package you are changing:

| Package | Guide | Purpose |
| --- | --- | --- |
| `agent-contracts` | `packages/agent-contracts/AGENTS.md` | Shared DTOs and constants across package boundaries |
| `agent-observability-langfuse` | `packages/agent-observability-langfuse/AGENTS.md` | Langfuse trace collector implementation |
| `agent-runtime` | `packages/agent-runtime/AGENTS.md` | Shared agent runtime assembly and orchestration |
| `moosestack-service` | `packages/moosestack-service/AGENTS.md` | Moose backend, semantic layer, HTTP APIs, and MCP tools |
| `web-app` | `packages/web-app/AGENTS.md` | Next.js host app, auth, chat UI, and host-side runtime wiring |

## Key Files

### `packages/agent-contracts/`

| File | Purpose |
| --- | --- |
| `AGENTS.md` | Package-local ownership rules and source layout |
| `src/index.ts` | Shared DTOs and constants used by the web app and Moose service |

### `packages/moosestack-service/`

| File | Purpose | Docs |
| --- | --- | --- |
| `AGENTS.md` | Package-local ownership rules and source layout | |
| `app/ingest/models.ts` | Data models plus explicit `OlapTable`, `Stream`, and `IngestApi` declarations | [Data Modeling](https://docs.fiveonefour.com/moosestack/data-modeling) |
| `app/semantic/` | Moose semantic/query models and tenant-scoped dashboard read composition | |
| `app/http/dashboard/api.ts` | Frontend-facing HTTP endpoint for dashboard reads | [BYO API with Express](https://docs.fiveonefour.com/moosestack/app-api-frameworks/express) |
| `app/mcp/server.ts` | Custom MCP server transport and tool wiring for `/tools` | [BYO API with Express](https://docs.fiveonefour.com/moosestack/app-api-frameworks/express) |
| `app/mcp/tool-access/exposed-surface.ts` | Allowlisted schema surface and SQL access policy for MCP tools. The default exposed table set is derived from `tenantIsolation.config.tables`. | |
| `test/` | Unit tests for service-local helpers like MCP query validation and catalog exposure | |
| `packages/moosestack-service/moose.config.toml` | Port and service configuration | |

### `packages/agent-runtime/`

| File | Purpose |
| --- | --- |
| `AGENTS.md` | Package-local ownership rules and source layout |
| `src/index.ts` | Public barrel for the runtime package |
| `src/runtime/` | Runtime contracts and provider/MCP assembly |
| `src/streams/` | Single-agent and multi-agent orchestration, trace lifecycle, and tool timing helpers |
| `src/observability-contract.ts` | Shared trace collector contract used by host-side sinks |
| `test/` | Integration tests for runtime assembly, provider selection, and MCP client wiring |

### `packages/agent-observability-langfuse/`

| File | Purpose |
| --- | --- |
| `AGENTS.md` | Package-local ownership rules and source layout |
| `src/index.ts` | Reusable Langfuse trace collector that implements the shared `TraceCollector` contract |

### `packages/web-app/`

| File | Purpose |
| --- | --- |
| `AGENTS.md` | Package-local ownership rules and source layout |
| `src/auth.ts` | Production auth wiring and provider/session setup |
| `src/dev/` | Development-only local tenant auth and mock guardrails |
| `src/components/ai-elements/` | Generic chat UI primitives imported from AI Elements |
| `src/lib/id-token.ts` | Shared ID token claim parsing for OIDC/local auth |
| `src/lib/chat-agent.ts` | Next-hosted adapter that injects env/config into the shared agent runtime |
| `src/lib/in-memory-trace-collector.ts` | Host-side fallback `TraceCollector` used when Langfuse is not configured |
| `src/lib/moose-service.ts` | Authenticated client for Moose-owned dashboard APIs |
| `src/app/api/chat/route.ts` | Chat API endpoint |
| `src/features/chat/` | Moose-specific chat wrappers, tool renderers, and provider-status UI |
| `test/` | Unit tests for host-side adapters, env-driven wiring, and frontend/service clients |
| `.env.example` | Copy this to `.env.local` for project-local overrides and secrets |

### Root testing

| File | Purpose |
| --- | --- |
| `vitest.config.ts` | Root Vitest config, project split, and source aliases |

## Common Tasks

### Adding a data model

MooseStack's core pattern: define a TypeScript interface once, then wire explicit component objects for the table, stream, and ingest API.

```typescript
// app/ingest/models.ts
import { IngestApi, OlapTable, Stream } from "@514labs/moose-lib";

export interface PageView {
  viewId: string;
  timestamp: Date;
  url: string;
  userId: string;
  durationMs: number;
}

export const PageViewTable = new OlapTable<PageView>("page_views", {
  orderByFields: ["userId", "timestamp"],
});

export const PageViewStream = new Stream<PageView>("page_views", {
  destination: PageViewTable,
});

export const PageViewIngestApi = new IngestApi<PageView>("page_views", {
  destination: PageViewStream, // POST /ingest/page_views
});
```

Use `orderByFields` when you need control over ClickHouse table ordering (put your most-filtered columns first). If you have the ClickHouse Best Practices Skill installed, use it to choose the right ordering for the user's query patterns.

For advanced table configuration (engines, indexes, projections), see `moose docs moosestack/olap/model-table`.

### Adding an API endpoint

This template uses Express. Add new frontend-facing endpoints under `app/http/` and create or extend `WebApp` instances from there:

```typescript
// app/http/analytics/api.ts
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
      FROM page_views
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
- Export the `WebApp` from the file and re-export it from `packages/moosestack-service/app/index.ts` so MooseStack discovers it automatically
- This template uses Express, but MooseStack also supports Fastify and FastAPI. See `moose docs moosestack/app-api-frameworks` for all options

### Adding an MCP tool

Register tools under `app/mcp/tools/` and wire them into `app/mcp/server.ts`. Tools get access to `mooseUtils` (ClickHouse client) via closure:

```typescript
// app/mcp/tools/example-tool.ts
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
    const rows = await executeReadonlyStatement(client.query, `SELECT ...`, 100);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }],
    };
  },
);
```

Key patterns from this template:

- Use `executeReadonlyStatement()` or `executeReadonlySql()` for DB access so readonly mode and row-policy settings are preserved
- Keep the MCP schema surface explicit in `app/mcp/tool-access/exposed-surface.ts`; do not expose `system.*` metadata by default
- Validate and constrain user-supplied SQL before execution
- Expect `moose.jwt.tenant_id` to exist before serving custom tool requests
- Return errors via `{ content: [...], isError: true }`, not by throwing

### Do / Don't

- **DO** specify `orderByFields` for production tables. **DON'T** rely on default ordering for performance-sensitive queries — specify based on query patterns.
- **DO** keep the MCP catalog and SQL surface allowlisted in `app/mcp/tool-access/exposed-surface.ts`. **DON'T** expose `system.tables`, `system.columns`, or undeclared tables by default.
- **DO** use `executeReadonlyStatement()` / `executeReadonlySql()` for MCP tool DB access. **DON'T** use `client.query.client.query()` directly without readonly settings and row-policy propagation.
- **DO** use explicit `OlapTable`, `Stream`, and `IngestApi` component objects for new data models. **DON'T** write raw CREATE TABLE DDL — MooseStack generates tables from your models.
- **DO** keep tenant-scoped tables consistent on a shared `tenant_id` column. **DON'T** mix tenant claim names across auth, tables, and row policies.
- **DO** return user-friendly error messages in MCP tool responses. **DON'T** expose internal error details or stack traces.
- **DO** export new primitives from `app/index.ts`. **DON'T** forget to export — MooseStack won't discover unexported primitives.
- **DO** place pure helper tests in `packages/*/test/**/*.unit.test.ts`. **DON'T** put package-crossing integration coverage in the unit project.
- **DO** place runtime wiring tests in `packages/*/test/**/*.integration.test.ts`. **DON'T** require a prebuilt `dist/` tree; the Vitest workspace aliases package imports to source.
- **DO** use the ClickHouse Best Practices Skill (if installed) for schema decisions. **DON'T** guess at ClickHouse data types or engine choices.
- **DO** keep reusable chat shell pieces in `packages/web-app/src/components/ai-elements/`. **DON'T** re-build generic conversation/message/input primitives inside `src/features/chat/`.
- **DO** keep Moose-specific behavior in `packages/web-app/src/features/chat/`. **DON'T** put tenant-aware tool rendering into the shared AI Elements layer.
- **DO** run `pnpm env:prepare` before local development so package env files exist. **DON'T** commit `.env.local`.

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

These are the tools exposed to the chat UI and external MCP clients. Edit them under `app/mcp/tools/` and wire them in `app/mcp/server.ts`.

| Tool | What it does | Parameters |
| --- | --- | --- |
| `get_data_catalog` | Discover only the tables and materialized views explicitly exposed in `app/mcp/tool-access/exposed-surface.ts`. | `component_type` (tables/materialized_views), `search` (regex), `format` (summary/detailed) |
| `query_tenant_knowledge_metrics` | Query tenant-scoped knowledge metrics through the semantic layer for counts, grouped rollups, and priority/category breakdowns. | `metrics`, `dimensions`, semantic filter params such as `timestamp_gte`, `category`, `priority`, `source`, plus `limit` |
| `list_tenant_knowledge_records` | List tenant-scoped knowledge records through the semantic layer for recent changes or detail inspection. | `columns`, semantic filter params such as `timestamp_gte`, `category`, `priority`, `headline_ilike`, plus `limit` |

### ClickHouse Best Practices Skill (optional)

Not included by default. Install with `514 agent init` to get rules for schema design, query optimization, insert strategy, and MooseStack-specific patterns.

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

This template uses JWT auth, not static API tokens.

| Variable | File | Purpose |
| --- | --- | --- |
| `AUTH_SECRET` | `packages/web-app/.env.local` | Auth.js session secret |
| `MOOSE_AUTH_MODE` | `packages/web-app/.env.local` | `local` for the built-in tenant picker, `oidc` for external OIDC |
| `AI_PROVIDER` | `packages/web-app/.env.local` | `anthropic`, `openai`, or `bedrock` |
| `MOOSE_SERVICE_URL` | `packages/web-app/.env.local` | Base Moose service URL for dashboard APIs and, by default, the custom MCP tools endpoint |
| `MCP_SERVER_URL` | `packages/web-app/.env.local` | Optional override for the custom MCP tools endpoint (`/tools`) when it differs from `MOOSE_SERVICE_URL` |
| `LOCAL_DEV_JWT_PRIVATE_KEY` | `packages/web-app/.env.local` | Generated by `pnpm env:prepare` for the local tenant picker flow |
| `MOOSE_JWT__SECRET` | `packages/moosestack-service/.env.local` | Generated by `pnpm env:prepare`; Moose uses it to verify the local tenant JWTs |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | `packages/web-app/.env.local` | Optional Langfuse tracing |
| `OIDC_*` | `packages/web-app/.env.local` | External OIDC configuration |

For local dev, the web app issues short-lived JWTs carrying `tenant_id`. Moose verifies those JWTs using `MOOSE_JWT__SECRET` from `packages/moosestack-service/.env.local`, while `packages/moosestack-service/moose.config.toml` keeps the expected issuer and audience.

## Documentation

- [Chat in Your App Tutorial](https://docs.fiveonefour.com/guides/chat-in-your-app/tutorial)
- [Data Modeling](https://docs.fiveonefour.com/moosestack/data-modeling)
- [OlapTable](https://docs.fiveonefour.com/moosestack/olap/model-table)
- [BYO API Frameworks](https://docs.fiveonefour.com/moosestack/app-api-frameworks)
- [Express Integration](https://docs.fiveonefour.com/moosestack/app-api-frameworks/express)
- [MooseDev MCP](https://docs.fiveonefour.com/moosestack/moosedev-mcp)
- [Semantic Layer / MCP Tools](https://docs.fiveonefour.com/moosestack/apis/semantic-layer)
- [Data Types](https://docs.fiveonefour.com/moosestack/data-types)
