# PR 3 of 5 — ClickHouse Dictionary: TypeScript SDK

**Full plan**: `docs/plans/3853-clickhouse-dictionary-support.md` (source of truth)
**Issue**: https://github.com/514-labs/moosestack/issues/3853
**Stack**: PR 1 (#3885) → PR 2 → **PR 3 (this)** → PR 4 → PR 5
**Base branch**: `514Ben/3853-clickhouse-dictionary-rust-integration`
**Working directory for this PR**: `packages/ts-moose-lib/`

## What this PR adds (~600 lines)

- NEW: `packages/ts-moose-lib/src/dmv2/sdk/olapDictionary.ts` — `OlapDictionary<T>` class, `sourceTable`/`sourceQuery`/`externalSource` (mutually exclusive), all 16 layout types, all 12 external source types, `get()`/`getOrDefault()`/`has()` helpers, self-registers into `getMooseInternal().olapDictionaries`
- `dmv2/internal.ts` — `olapDictionaries` registry + serialization
- `dmv2/dataModelMetadata.ts` — `["OlapDictionary", 1]` in `typesToArgsLength`
- `sqlHelpers.ts` — `OlapDictionary` interpolation + consumer-side dependency recording
- `dmv2/index.ts`, `browserCompatible.ts` — exports

## Unit tests to add

Location: `packages/ts-moose-lib/src/` (colocated, mocha)

- Construction and field defaults
- Validation: mutually exclusive sources, required fields
- Registration into `getMooseInternal().olapDictionaries`
- Serialization matches Rust's expected JSON shape (camelCase keys, SCREAMING_SNAKE_CASE enum values)
- `get()`/`getOrDefault()`/`has()` SQL helper output
- Composite primary keys
- All 16 layout types serialize correctly
- Named Collection source → throws validation error

## Key conventions

- Mirror `OlapTable` / `MaterializedView` patterns in the SDK exactly
- camelCase field names, SCREAMING_SNAKE_CASE enum values (matches Rust `#[serde(rename_all)]`)
- Run `pnpm typecheck` and `pnpm test` in `packages/ts-moose-lib/` before committing
- Run `pnpm format` (Prettier) before committing
