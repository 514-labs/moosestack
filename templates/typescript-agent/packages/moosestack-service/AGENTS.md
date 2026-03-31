# moosestack-service

MooseStack backend package for the TypeScript agent template.

## Ownership

This package owns:

- organization-scoped ingest models and row policies
- JWT claim parsing and request-level access context
- Moose semantic/query models for frontend and tool reads
- frontend-facing HTTP APIs mounted through `WebApp`
- custom MCP tools and the MCP allowlist policy
- readonly ClickHouse query helpers used by the semantic layer and MCP tools

This package does not own:

- Next.js route handlers or session management
- AI provider/model selection
- Langfuse or other chat/runtime observability sinks

## Source Layout

| Path | Purpose |
| --- | --- |
| `app/index.ts` | Public service entrypoint. Export Moose-discovered primitives here. |
| `app/ingest/` | Explicit `OlapTable`, `Stream`, `IngestApi`, and row-policy declarations. |
| `app/semantic/` | Moose `defineQueryModel()` declarations and read-model composition. |
| `app/data/clickhouse/` | Low-level readonly ClickHouse execution helpers. |
| `app/auth/` | JWT claim names plus tenant/admin access-context helpers. |
| `app/http/` | Frontend-facing HTTP APIs. |
| `app/mcp/` | MCP server transport, tool registration, tool parsing, and allowlist policy. |
| `seed/` | Seed SQL for local/demo data. |
| `test/` | Service-local unit tests for pure helpers and read-model composition. |

## Rules

- Put `defineQueryModel()` declarations in `app/semantic/`, not beside HTTP or MCP transport code.
- Keep direct ClickHouse client calls inside `app/data/clickhouse/` so readonly settings and row-policy propagation stay centralized.
- Keep Express transport code in `app/http/` or `app/mcp/`. Shared auth/context helpers belong in `app/auth/`, not beside individual routes.
- Keep MCP allowlist and SQL validation logic in `app/mcp/tool-access/`. Do not mix policy code into the transport file.
- If you change schemas, query patterns, or ClickHouse settings, use the ClickHouse Best Practices Skill and validate the resulting table/query shape.

## Testing

From the template root:

```bash
pnpm format
pnpm test
pnpm build
pnpm build:service
pnpm lint
```
