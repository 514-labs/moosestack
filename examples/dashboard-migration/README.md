# Dashboard Migration: Context Pack + Prompt

This folder is the **canonical starter kit** for doing an AI-assisted dashboard migration from OLTP → ClickHouse (MooseStack).

It contains:

- **Context pack template**: [`component-context-pack-template.md`](component-context-pack-template.md)  
  Fill this out once per dashboard/report component so your copilot has the contract, the current OLTP implementation, and parity verification inputs.
- **Prompt template**: [`prompt.md`](prompt.md)  
  Paste this into your AI copilot. It references your filled context pack via `@`.

## Copy into your project (one command)

Run this from your project root:

```bash
pnpm dlx tiged 514-labs/moosestack/examples/dashboard-migration context/migrations
```

This creates `context/migrations/` with the template + prompt.

## How to use

1. **Duplicate the context pack template** for the component you’re migrating, e.g. `context/migrations/COMPONENT_NAME.md`.
2. **Fill it out** with links/paths to:
   - API contract (request/response schema, auth/tenancy constraints)
   - Frontend caller + backend handler
   - OLTP SQL artifacts the handler depends on (stored procedures, views, etc.)
   - Golden input→output cases for parity
3. **Open `context/migrations/prompt.md`**, replace placeholders, and paste it into your copilot. Make sure the prompt references your filled file via `@context/migrations/COMPONENT_NAME.md`.

For the full workflow and where this fits in the parity → MVs → Query Layer migration path, see the guide: [Improving the Performance of Your Dashboards](https://docs.fiveonefour.com/moose/guides/performant-dashboards).



