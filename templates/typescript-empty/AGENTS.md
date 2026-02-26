# AGENTS.md

Empty MooseStack TypeScript template - minimal starting point.

## Development

- **Start dev server**: `pnpm dev` (or `npx moose-cli dev`)
- **Build**: `pnpm build`

## Hot Reload

Moose has built-in hot reload. When you modify files referenced in `app/index.ts`, changes are automatically detected and applied. **Do not restart the dev server** after code changes - just save the file and Moose handles the rest.

## Project Structure

- `app/index.ts` - Entry point that exports all Moose primitives
- `app/ingest/` - Data models and ingestion transforms

## Adding Components

Add files and export them from `app/index.ts`:

```typescript
// app/index.ts
export * from "./ingest/models";
export * from "./apis/myApi";
```

## Docs

- [MooseStack Documentation](https://docs.fiveonefour.com/moose)
