# AGENTS.md

MooseStack TypeScript cluster template for distributed deployments.

## Development

- **Start dev server**: `pnpm dev` (or `npx moose-cli dev`)
- **Build**: `pnpm build`

## Hot Reload

Moose has built-in hot reload. When you modify files referenced in `src/index.ts`, changes are automatically detected and applied. **Do not restart the dev server** after code changes - just save the file and Moose handles the rest.

## Project Structure

- `src/index.ts` - Entry point that exports all Moose primitives
- `src/ingest/` - Data models and ingestion transforms

## Adding Components

Add files and export them from `src/index.ts`:

```typescript
// src/index.ts
export * from "./ingest/models";
```

## Docs

- [MooseStack Documentation](https://docs.fiveonefour.com/moose)
