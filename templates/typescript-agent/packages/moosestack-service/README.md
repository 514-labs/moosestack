# moosestack-service

MooseStack backend for the template.

This package owns:

- tenant-scoped data models
- JWT-backed row-level security
- query-layer reads
- app-facing dashboard APIs
- custom MCP tools
- seed data

## Key Areas

- `app/ingest/models.ts` — table definitions and row policies
- `app/apis/dashboard.ts` — app-facing HTTP endpoints for frontend reads
- `app/apis/mcp.ts` — custom MCP tool registration
- `app/apis/tool-access.ts` — tool allowlist wiring
- `app/apis/tool-access-core.ts` — pure schema/catalog/query validation logic
- `app/query/` — Moose-owned query helpers
- `seed/` — starter SQL seed files
- `test/` — service-local unit tests

## Commands

From the template root:

```bash
pnpm dev:moose
pnpm build:service
pnpm seed
pnpm test:unit -- packages/moosestack-service/test
```

`pnpm seed` applies the starter SQL and then prints inserted-record counts plus current totals by tenant.

## Notes

- Keep tenant boundaries enforced here, not in the web app.
- Keep the MCP schema surface allowlisted by default.
- Prefer pure helper logic in `app/apis/tool-access-core.ts` when adding testable policy code.
