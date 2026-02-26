# AGENTS.md

MooseStack ADS-B (Automatic Dependent Surveillance-Broadcast) flight tracking template.

## Development

- **Start dev server**: `pnpm dev` (or `npx moose-cli dev`)
- **Build**: `pnpm build`

## Hot Reload

Moose has built-in hot reload. When you modify files referenced in `app/index.ts`, changes are automatically detected and applied. **Do not restart the dev server** after code changes - just save the file and Moose handles the rest.

## Project Structure

- `app/index.ts` - Entry point that exports all Moose primitives
- `app/` - Data models, APIs, and views for flight data

## Adding Components

Add files and export them from `app/index.ts`:

```typescript
// app/index.ts
export * from "./models";
export * from "./apis/myApi";
```

## Docs

- `moose docs` — browse all available documentation
- `moose docs search "query"` — find specific topics
- `moose docs --raw <slug> | claude "..."` — pipe docs directly to your AI assistant
- [MooseStack Documentation](https://docs.fiveonefour.com/moose)
- [LLM-friendly docs](https://docs.fiveonefour.com/llms.txt)
