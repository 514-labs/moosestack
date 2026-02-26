# AGENTS.md

MooseStack Brainwaves template - monorepo for EEG/brain data processing.

## Development

- **Start dev server**: `pnpm dev` (in brainmoose app)
- **Build**: `pnpm build`

## Hot Reload

Moose has built-in hot reload. When you modify files referenced in `apps/brainmoose/app/index.ts`, changes are automatically detected and applied. **Do not restart the dev server** after code changes - just save the file and Moose handles the rest.

## Project Structure

- `apps/brainmoose/` - Moose backend service
- `apps/brainmoose/app/index.ts` - Entry point for Moose primitives

## Docs

- `moose docs` — browse all available documentation
- `moose docs search "query"` — find specific topics
- `moose docs --raw <slug> | claude "..."` — pipe docs directly to your AI assistant
- [MooseStack Documentation](https://docs.fiveonefour.com/moose)
- [LLM-friendly docs](https://docs.fiveonefour.com/llms.txt)
