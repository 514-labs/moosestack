# PR 4 of 5 — ClickHouse Dictionary: Python SDK

**Full plan**: `docs/plans/3853-clickhouse-dictionary-support.md` (source of truth)
**Issue**: https://github.com/514-labs/moosestack/issues/3853
**Stack**: PR 1 (#3885) → PR 2 → PR 3 → **PR 4 (this)** → PR 5
**Base branch**: `514Ben/3853-clickhouse-dictionary-typescript-sdk`
**Working directory for this PR**: `packages/py-moose-lib/`

## What this PR adds (~500 lines)

- NEW: `packages/py-moose-lib/moose_lib/dmv2/olap_dictionary.py` — `OlapDictionary` class extending `BaseTypedResource`, `OlapDictionaryConfig` (Pydantic), all layout/source Pydantic models, `get()`/`get_or_default()`/`has()`, `model_post_init` validation
- `dmv2/_registry.py` — `_olap_dictionaries` dict
- `dmv2/registry.py` — `get_olap_dictionaries()` accessor
- `internal.py` — `OlapDictionaryJson` serialization model, `to_infra_map()` conversion
- `dmv2/__init__.py`, `moose_lib/__init__.py` — exports

## Unit tests to add

Location: `packages/py-moose-lib/tests/` (pytest)

Mirror of TypeScript tests:
- Construction and field defaults
- Validation: mutually exclusive sources, required fields, `model_post_init` errors
- Registration into `get_olap_dictionaries()`
- Serialization matches Rust's expected JSON shape (camelCase keys, SCREAMING_SNAKE_CASE enum values)
- `get()`/`get_or_default()`/`has()` SQL helper output
- Composite primary keys
- All 16 layout types serialize correctly
- Named Collection source → raises validation error

## Key conventions

- Mirror `OlapTable` / `MaterializedView` patterns in the Python SDK exactly
- Use Pydantic v2 (`model_validator`, `field_validator`)
- camelCase JSON serialization (`model_config = ConfigDict(populate_by_name=True)`) to match Rust serde shape
- Run `pytest` in `packages/py-moose-lib/` before committing
- Run `black` for formatting before committing
