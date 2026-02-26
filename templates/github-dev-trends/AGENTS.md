# AGENTS.md

MooseStack GitHub Developer Trends template - analytics for GitHub activity.

## Development

- **Start dev server**: `pnpm dev` (in moose-backend app)
- **Build**: `pnpm build`

## Hot Reload

Moose has built-in hot reload. When you modify files referenced in `apps/moose-backend/app/index.ts`, changes are automatically detected and applied. **Do not restart the dev server** after code changes - just save the file and Moose handles the rest.

## Project Structure

- `apps/moose-backend/` - Moose backend service
- `packages/moose-objects/` - Shared data models

## Docs

- [MooseStack Documentation](https://docs.fiveonefour.com/moose)
