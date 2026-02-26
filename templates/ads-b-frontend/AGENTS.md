# AGENTS.md

MooseStack ADS-B frontend template with visualization.

## Development

- **Start dev server**: `pnpm dev`
- **Build**: `pnpm build`

## Hot Reload

Moose has built-in hot reload. When you modify files referenced in `moose/app/index.ts`, changes are automatically detected and applied. **Do not restart the dev server** after code changes - just save the file and Moose handles the rest.

## Project Structure

- `moose/` - Moose backend service
- `moose/app/index.ts` - Entry point for Moose primitives

## Docs

- `moose docs` — browse all available documentation
- `moose docs search "query"` — find specific topics
- `moose docs --raw <slug> | claude "..."` — pipe docs directly to your AI assistant
- [MooseStack Documentation](https://docs.fiveonefour.com/moose)
- [LLM-friendly docs](https://docs.fiveonefour.com/llms.txt)
