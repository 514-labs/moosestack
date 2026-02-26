# AGENTS.md

MooseStack TypeScript application with OLAP database, streaming, and APIs.

## Development

- **Start dev server**: `pnpm dev` (or `npx moose-cli dev`)
- **Build**: `pnpm build`

## Hot Reload

Moose has built-in hot reload. When you modify files referenced in `app/index.ts`, changes are automatically detected and applied. **Do not restart the dev server** after code changes - just save the file and Moose handles the rest.

## Project Structure

- `app/index.ts` - Entry point that exports all Moose primitives
- `app/ingest/` - Data models and ingestion transforms
- `app/apis/` - API endpoints
- `app/views/` - Materialized views
- `app/workflows/` - Background workflows

## Adding Components

Use `moose generate` or manually add files and export them from `app/index.ts`:

```typescript
// app/index.ts
export * from "./ingest/models";
export * from "./apis/myApi";
```

## Docs

- `moose docs` — browse all available documentation
- `moose docs search "query"` — find specific topics
- `moose docs --raw <slug>` — output raw markdown (for AI consumption)
- [MooseStack Documentation](https://docs.fiveonefour.com/moose)
- [TypeScript SDK Reference](https://docs.fiveonefour.com/moose/building/overview)
- [LLM-friendly docs](https://docs.fiveonefour.com/llms.txt)
