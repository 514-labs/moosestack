# moosestack-service

MooseStack backend for the template.

This package owns:

- organization-scoped data models
- JWT claim parsing and request-level authorization
- JWT-backed row-level security
- Moose semantic/query models
- app-facing HTTP APIs
- custom MCP tools and the MCP allowlist policy
- readonly ClickHouse helpers for semantic reads and tool execution
- seed data

## Source Layout

| Path | Purpose |
| --- | --- |
| `app/index.ts` | Public entrypoint. Export Moose-discovered primitives here. |
| `app/auth/` | JWT claim names plus tenant/admin access-context helpers. |
| `app/ingest/` | `IngestPipeline` declarations plus explicit `OlapTable`, `Stream`, `IngestApi`, and row-policy declarations. |
| `app/semantic/` | Moose `defineQueryModel()` declarations and dashboard/read-model composition. |
| `data/clickhouse/` | Low-level readonly ClickHouse helpers. |
| `http/` | Shared HTTP middleware such as rate limiting. |
| `app/http/` | Frontend-facing Express APIs. |
| `app/mcp/` | MCP transport, tool registration, allowlist policy, and tool-specific parsers/errors. |
| `seed/` | Starter SQL seed files. |
| `test/` | Service-local unit tests. |

## Commands

From the template root:

```bash
pnpm dev:moose
pnpm build:service
pnpm seed
pnpm test:unit -- packages/moosestack-service/test
```

`pnpm seed` applies the starter SQL and then prints inserted-record counts plus current totals by organization.

## Notes

- Keep tenant boundaries enforced here, not in the web app.
- Keep authentication and authorization helpers in `app/auth/` so route files stay thin.
- Keep Moose semantic models in `app/semantic/` so the read layer is visible.
- Keep the MCP schema surface allowlisted by default in `app/mcp/tool-access/`.
- Use `packages/moosestack-service/.env.local` with `MOOSE_CLICKHOUSE_CONFIG__*` overrides when you want this template to connect to an existing ClickHouse instance instead of the local Docker defaults.
- Prefer pure helper logic in `app/mcp/tool-access/`, `app/mcp/parsers/`, and `app/mcp/errors/` when adding testable MCP behavior.
