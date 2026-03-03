# TypeScript MCP Template

pnpm monorepo: MooseStack backend (`packages/moosestack-service`) + Next.js chat frontend (`packages/web-app`).

## Architecture

```
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

## Copilot Setup

### MooseDev MCP (built-in)
Pre-configured in `.mcp.json` at the project root. Most tools pick this up automatically when the dev server is running.

### ClickHouse Best Practices Skill
```bash
npx skills add https://github.com/514-labs/agent-skills --skill moosestack-clickhouse-best-practices
```

### Context7 for MooseStack Documentation
Pre-configured in `.mcp.json`. Add "use context7" to prompts when referencing MooseStack docs.

## Relevant Documentation

- [Chat in Your App Tutorial](https://docs.fiveonefour.com/guides/chat-in-your-app/tutorial)
- [Data Modeling](https://docs.fiveonefour.com/moosestack/data-modeling)
- [OlapTable](https://docs.fiveonefour.com/moosestack/olap/model-table)
- [BYO API Frameworks](https://docs.fiveonefour.com/moosestack/app-api-frameworks)
- [Express Integration](https://docs.fiveonefour.com/moosestack/app-api-frameworks/express)
- [MooseDev MCP](https://docs.fiveonefour.com/moosestack/moosedev-mcp)
- [Semantic Layer / MCP Tools](https://docs.fiveonefour.com/moosestack/apis/semantic-layer)
- [Data Types](https://docs.fiveonefour.com/moosestack/data-types)
