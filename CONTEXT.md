# PR 5 of 5 — ClickHouse Dictionary: E2E Tests & Docs

**Full plan**: `docs/plans/3853-clickhouse-dictionary-support.md` (source of truth)
**Issue**: https://github.com/514-labs/moosestack/issues/3853
**Stack**: PR 1 (#3885) → PR 2 → PR 3 → PR 4 → **PR 5 (this)**
**Base branch**: `514Ben/3853-clickhouse-dictionary-python-sdk`
**Working directories**: `templates/`, `apps/framework-docs-v2/`

## What this PR adds (~400 lines)

### E2E Tests
- `templates/typescript-tests/` — add `OlapDictionary` usage: define a dictionary over an existing OlapTable, verify `moose plan` generates correct DDL, verify `moose dev` creates the dictionary in ClickHouse
- `templates/python-tests/` — mirror of TypeScript E2E tests

### Documentation (`apps/framework-docs-v2/`)
- SDK reference page: `OlapDictionary` constructor options, all layout types with examples, all source types with examples
- Tutorial: "Accelerate lookups with ClickHouse Dictionaries"
- Migration guide: the `EXTERNALLY_MANAGED` escape hatch for dictionaries managed outside Moose
- Known limitations section: ClickHouse 22.4+ requirement, Named Collections not supported, no dict-to-dict sources

### Template lockfile updates
- Regenerate `pnpm-lock.yaml` in any template that changes

## Key conventions

- E2E tests must be runnable via `cd apps/framework-cli-e2e && pnpm test`
- Templates cannot be run directly from the repo — must be initialized in `/tmp` first (see root CLAUDE.md)
- Docs site: see `apps/framework-docs-v2/CLAUDE.md` for doc conventions
- After changing templates, always run `pnpm install` in the template dir and commit the updated lockfile
