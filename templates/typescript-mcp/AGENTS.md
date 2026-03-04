# TypeScript MCP Template

pnpm monorepo: MooseStack backend (`packages/moosestack-service`) + Next.js chat frontend (`packages/web-app`).

## Architecture

```text
Next.js App (Chat UI -> /api/chat -> MCP Client)
    | HTTP + Bearer Token |
MooseStack Service (Custom MCP Server at /tools -> ClickHouse)
```

Two MCP servers run on the same host:
- `/mcp` — MooseStack's [built-in MCP server](https://docs.fiveonefour.com/moosestack/moosedev-mcp) (for AI copilot dev assistance)
- `/tools` — This template's custom MCP server (for the chat UI and external clients)

## Key Files

### `packages/moosestack-service/`

| File | Purpose | Docs |
| --- | --- | --- |
| `app/apis/mcp.ts` | Custom MCP server (tools, auth middleware, `/tools` endpoint) | [BYO API with Express](https://docs.fiveonefour.com/moosestack/app-api-frameworks/express) |
| `app/ingest/models.ts` | Data models (interfaces + OlapTable declarations) | [OlapTable](https://docs.fiveonefour.com/moosestack/olap/model-table) |
| `moose.config.toml` | Port and service configuration | |

### `packages/web-app/`

| File | Purpose |
| --- | --- |
| `src/features/chat/system-prompt.ts` | AI system prompt — customize this for your data |
| `src/features/chat/agent-config.ts` | MCP client setup (model, tools, transport) |
| `src/app/api/chat/route.ts` | Chat API endpoint |
| `.env.development` | Default local dev config (`MCP_SERVER_URL=http://localhost:4000`) |

## Environment Variables

`moose generate hash-token` outputs a key pair — the hash goes to the backend and the token goes to the frontend:

| Variable | File | Value |
| --- | --- | --- |
| `MCP_API_KEY` | `packages/moosestack-service/.env.local` | `ENV API Key` (hash) |
| `MCP_API_TOKEN` | `packages/web-app/.env.local` | `Bearer Token` |
| `ANTHROPIC_API_KEY` | `packages/web-app/.env.local` | Anthropic API key |
| `MCP_SERVER_URL` | `packages/web-app/.env.development` | Pre-set to `http://localhost:4000` |

## Custom MCP Tools (at `/tools`)

### `query_clickhouse`

- Executes read-only SQL (SELECT, SHOW, DESCRIBE, EXPLAIN)
- Blocks writes (INSERT, UPDATE, DELETE) and DDL (DROP, CREATE, ALTER, TRUNCATE)
- Parameters: `query` (required), `limit` (optional, default 100, max 1000)
- Enforces ClickHouse readonly mode
- Uses `currentDatabase()` automatically

### `get_data_catalog`

- Discovers tables and materialized views with schema info
- Parameters: `component_type` (tables/materialized_views), `search` (regex), `format` (summary/detailed)
- Uses `currentDatabase()` automatically

## Agent Harness

This template includes an agent harness — tools you MUST ensure are active before working on this project.

### 1. MooseDev MCP (built-in)

Pre-configured in `.mcp.json` at the project root. Verify it is connected. The project must be initialized (`moose init`) and the dev server (`pnpm dev:moose`) must be running for it to work.

### 2. Context7 for MooseStack Documentation

Pre-configured in `.mcp.json`. Use Context7 when referencing MooseStack docs by adding "use context7" to your prompts.

### 3. ClickHouse Best Practices Skill

Install the skill at the start of every session if it is not already installed:

```bash
npx skills add https://github.com/514-labs/agent-skills --skill moosestack-clickhouse-best-practices
```

Use this skill when working with ClickHouse schemas, queries, or data models.

## When to Use What

### MooseDev MCP tools (via `.mcp.json`)

Use these for live inspection of the running project:

| Tool | When to use |
| --- | --- |
| `get_infra_map` | First step — understand project topology (tables, streams, APIs, workflows) and data flow |
| `query_olap` | Explore data, verify ingestion, check schemas (read-only SQL) |
| `get_logs` | Debug errors, connection issues, or unexpected behavior in the dev server |
| `get_issues` | Diagnose infrastructure health (stuck mutations, replication errors, S3Queue failures) |
| `get_stream_sample` | Inspect recent messages from streaming topics to verify data flow |

### ClickHouse Best Practices Skill

Use when creating or refining data models, writing ClickHouse queries, designing schemas, or configuring materialized views. The skill contains rules covering schema design, query optimization, insert strategy, and MooseStack-specific patterns.

### Context7

Use when you need to reference MooseStack documentation — add "use context7" to your prompt.

### Moose CLI commands

Use `moose --help` to discover all commands. These are the most useful for getting context:

| Command | Purpose |
| --- | --- |
| `moose docs <slug>` | Fetch MooseStack documentation (e.g., `moose docs moosestack/olap`) |
| `moose docs search "query"` | Search documentation by keyword |
| `moose query "SQL"` | Execute SQL directly against ClickHouse |
| `moose ls` | List all project primitives (tables, streams, APIs, workflows) |
| `moose peek <name>` | View sample data from a table or stream |
| `moose logs` | View dev server logs (use `-f "error"` to filter) |
| `moose --help` | Discover all available commands |

Prefer MooseDev MCP tools over CLI commands when both can accomplish the task — MCP tools return structured, token-optimized output.

## Relevant Documentation

- [Chat in Your App Tutorial](https://docs.fiveonefour.com/guides/chat-in-your-app/tutorial)
- [Data Modeling](https://docs.fiveonefour.com/moosestack/data-modeling)
- [OlapTable](https://docs.fiveonefour.com/moosestack/olap/model-table)
- [BYO API Frameworks](https://docs.fiveonefour.com/moosestack/app-api-frameworks)
- [Express Integration](https://docs.fiveonefour.com/moosestack/app-api-frameworks/express)
- [MooseDev MCP](https://docs.fiveonefour.com/moosestack/moosedev-mcp)
- [Semantic Layer / MCP Tools](https://docs.fiveonefour.com/moosestack/apis/semantic-layer)
- [Data Types](https://docs.fiveonefour.com/moosestack/data-types)
