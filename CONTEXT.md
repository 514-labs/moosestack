# PR 2 of 5 — ClickHouse Dictionary: Rust Integration

**Full plan**: `docs/plans/3853-clickhouse-dictionary-support.md` (source of truth)
**Issue**: https://github.com/514-labs/moosestack/issues/3853
**Stack**: PR 1 (#3885) → **PR 2 (this)** → PR 3 → PR 4 → PR 5
**Base branch**: `514Ben/3853-clickhouse-dictionary-rust-core`

## What this PR adds (~400 lines)

- `plan_risk.rs` — `DestructiveChange::DictionaryDrop` + `OperationalRisk::DictionaryReplace`
- `plan_validator.rs` — source table exists, primaryKey valid, layout-key compatibility, cluster refs, reject dict-to-dict, reject Named Collections
- `plan.rs` — `dictionary_ids` in `ReconciliationFilter`, SQL normalization for dictionary sources
- `infra_reality_checker.rs` — dictionary discrepancy fields + `is_empty()`
- `cli/routines/ls.rs` — dictionaries in `ResourceListing`
- `olap/mod.rs` — `list_dictionaries()` on `OlapOperations` trait (existence/status only)
- `display/infrastructure.rs` — plan display for dictionary changes (already partially done in PR 1)

## Unit tests to add (inline `#[cfg(test)]`)

- `plan_risk.rs`: dictionary drop → `DestructiveChange`, dictionary replace (CACHE layout) → `OperationalRisk`, dictionary replace (HASHED) → low risk
- `plan_validator.rs`: source table missing → error, invalid primaryKey column → error, HASHED with multi-column key → error, COMPLEX_KEY_HASHED with multi-column key → ok, Named Collection reference → error, dict-to-dict source → error
- `ddl_ordering.rs`: dictionary ordered after source table, dictionary ordered before dependent MV, cycle detection → error
- `infra_reality_checker.rs`: unmapped/missing/mismatched dictionary discrepancies, `is_empty()` with dictionary fields
- `plan.rs`: SQL normalization stability for dictionary source queries

## Key conventions

- Mirror `MaterializedView` / `SelectRowPolicy` patterns exactly
- Use `thiserror` for errors, never `anyhow::Result`
- Run `cargo clippy --all-targets -- -D warnings` before committing (zero warnings)
- Run `cargo fmt` before committing
