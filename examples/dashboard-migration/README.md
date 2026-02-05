# Dashboard Migration Copilot Workspace (Context + Skills)

This folder is the **canonical starter kit** for an AI-assisted dashboard migration from OLTP → ClickHouse (MooseStack).
It bundles the context workspace **and** the migration skills so you only copy one folder into your project.

It contains:

- **Context workspace**: `dashboard-migration/` (templates + example)
- **Migration skills**: `rules/skills/` (Phase 1–3 checkpoint workflows)

## Copy into your project (one command)

Run this from your repo root (where `moosestack/` lives), or adjust the destination path to match your project layout:

```bash
pnpm dlx tiged 514-labs/moose/examples/dashboard-migration-context moosestack/context
```

This creates:

- `moosestack/context/dashboard-migration/` (context-map + prompt templates + example)
- `moosestack/context/rules/skills/` (dashboard migration skills)

## How to use

1. **Duplicate the context map template** for the component you’re migrating, e.g. `moosestack/context/dashboard-migration/<component-name>/context-map.md`.
2. **Open the prompt template** at `moosestack/context/dashboard-migration/_templates/prompt.md`, replace placeholders, and paste it into your copilot.
3. **Follow the checkpoints** in the skill files under `moosestack/context/rules/skills/`.
4. *(Optional)* Inspect `moosestack/context/dashboard-migration/example-order-fulfillment/` for a full example of the files created across Phases 1–3.

For the full workflow and where this fits in the parity → MVs → Query Layer migration path, see the guide:
https://docs.fiveonefour.com/moose/guides/performant-dashboards
