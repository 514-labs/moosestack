# AGENTS.md

MooseStack TypeScript MCP (Model Context Protocol) template - monorepo with MCP server and Moose backend.

## Development

- **Start dev server**: `pnpm dev` (in moosestack-service package)
- **Build**: `pnpm build`

## Hot Reload

Moose has built-in hot reload. When you modify files referenced in `packages/moosestack-service/app/index.ts`, changes are automatically detected and applied. **Do not restart the dev server** after code changes - just save the file and Moose handles the rest.

## Project Structure

- `packages/moosestack-service/` - Moose backend service
- `packages/moosestack-service/app/index.ts` - Entry point for Moose primitives

## Adding Components

Add files and export them from the service's `app/index.ts`:

```typescript
// packages/moosestack-service/app/index.ts
export * from "./ingest/models";
export * from "./apis/myApi";
```

## Docs

- [MooseStack Documentation](https://docs.fiveonefour.com/moose)
- [MCP Documentation](https://modelcontextprotocol.io/)
