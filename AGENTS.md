# AGENTS.md

Multi-language monorepo (Rust CLI + TypeScript/Python libraries) using PNPM workspaces, Turbo Repo, and Cargo workspace.

**CRITICAL**: When changing MooseStack functionality, ALWAYS run end-to-end tests. When changing user-facing features, add E2E tests to `python-tests`/`typescript-tests` templates AND audit documentation. Logs: `~/.moose/*-cli.log`. Always format the code.

## Build & Development Commands

### All Languages
- **Build all**: `pnpm build` (Turbo orchestrates builds)
- **Dev mode**: `pnpm dev` (starts dev servers)
- **Clean**: `pnpm clean`
- **Lint all**: `pnpm lint`
- **Format**: `pnpm format` (Prettier for TS/JS)

### Rust
- **Build**: `cargo build`
- **Debug CLI**: Use debug build with verbose logging for ALL moose CLI commands:
  ```bash
  RUST_LOG=debug RUST_BACKTRACE=1 MOOSE_LOGGER__LEVEL=Debug ~/repos/moosestack/target/debug/moose-cli <command>
  ```
  Example: `RUST_LOG=debug RUST_BACKTRACE=1 MOOSE_LOGGER__LEVEL=Debug ~/repos/moosestack/target/debug/moose-cli init my-app typescript`
- **Test all**: `cargo test`
- **Test single**: `cargo test <test_name>` or `cargo test --package <package_name> --test <test_file>`
- **Lint**: `cargo clippy --all-targets -- -D warnings` (REQUIRED pre-commit, no warnings allowed)
- **Format**: `cargo fmt`

### TypeScript
- **Test lib**: `cd packages/ts-moose-lib && pnpm test` (runs mocha tests)
- **Test single**: `cd packages/ts-moose-lib && pnpm test --grep "test name pattern"`
- **Typecheck**: `cd packages/ts-moose-lib && pnpm typecheck`

### Python
- **Test lib**: `cd packages/py-moose-lib && pytest`
- **Test single**: `cd packages/py-moose-lib && pytest tests/test_file.py::test_function_name`
- **Test pattern**: `cd packages/py-moose-lib && pytest -k "test_pattern"`

### End-to-End Tests
- **Run E2E**: `cd apps/framework-cli-e2e && pnpm test` (includes pretest: cargo build, pnpm build, package templates)
- **Single E2E test**: `cd apps/framework-cli-e2e && pnpm test --grep "test name"`

### Testing Templates Manually
Templates cannot be run directly from within the repo—they must be initialized in a temp directory first. To test a template using the current branch's CLI and moose-lib versions:
```bash
# 1. Build the CLI
cargo build --package moose-cli

# 2. Package templates (creates tgz files with current template content)
node scripts/package-templates.js

# 3. Initialize template in a temp directory (outside the repo)
cd /tmp && ~/repos/moosestack/target/debug/moose-cli init my-test-app <template-name>

# 4. Verify the lockfile is up-to-date
cd /tmp/my-test-app && pnpm install
git status  # Should show "nothing to commit, working tree clean"
```
If the lockfile changes after `pnpm install`, regenerate it in the template source directory:
```bash
cd ~/repos/moosestack/templates/<template-name>
rm -rf node_modules && pnpm install
# Commit the updated pnpm-lock.yaml
```

## Code Style Guidelines

### TypeScript/JavaScript
- **Imports**: Group by external deps, internal modules, types; use named exports from barrel files (`index.ts`)
- **Naming**: camelCase for vars/functions, PascalCase for types/classes/components, UPPER_SNAKE_CASE for constants
- **Types**: Prefer interfaces for objects, types for unions/intersections; explicit return types on public APIs
- **Unused vars**: Prefix with `_` (e.g., `_unusedParam`) to bypass linting errors
- **Formatting**: Prettier with `experimentalTernaries: true`; auto-formats on commit (Husky + lint-staged)
- **ESLint**: Extends Next.js, Turbo, TypeScript recommended; `@typescript-eslint/no-explicit-any` disabled

### Rust
- **Error handling**: Use `thiserror` with `#[derive(thiserror::Error)]`; define errors near fallibility unit (NO global `Error` type); NEVER use `anyhow::Result`
- **Naming**: snake_case for functions/vars, PascalCase for types/traits, SCREAMING_SNAKE_CASE for constants
- **Constants**: Place in `constants.rs` at appropriate module level
- **Newtypes**: Use tuple structs with validation constructors (e.g., `struct UserId(String)`)
- **Tests**: Inline with `#[cfg(test)]` modules
- **Documentation**: Required for all public APIs

### Python
- **Style**: Follow PEP 8; snake_case for functions/vars, PascalCase for classes, UPPER_SNAKE_CASE for constants
- **Formatting**: Black (line-length 88); auto-formats on commit (Husky + lint-staged)
- **Format manually**: `black <file_or_directory>`
- **Types**: Use type hints for function signatures and public APIs
- **Tests**: Use pytest with fixtures and parametrize decorators

## Repository Structure

- **`apps/`**: CLI (`framework-cli/`), docs (`framework-docs-v2/`, see its own CLAUDE.md for details), E2E tests (`framework-cli-e2e/`)
- **`packages/`**: Libraries (`ts-moose-lib/`, `py-moose-lib/`), shared deps, protobuf definitions
- **`templates/`**: Standalone Moose apps used by E2E tests (NOT for unit tests)

## Testing Philosophy

- **Library tests** (`packages/*/tests/`): Unit tests colocated with library code
- **Templates** (`templates/python-tests`, `templates/typescript-tests`): Complete Moose apps for E2E testing; must run in isolation

## Key Technologies

Rust (CLI), TypeScript (libs/web), Python (lib), ClickHouse (OLAP), Redpanda/Kafka (streaming), Temporal (workflows), Redis (state)

## ClickHouse Best Practices

When working with MooseStack data models, ClickHouse schemas, queries, or configurations, reference the `moosestack-clickhouse-best-practices` skill. It contains rules covering:
- Schema design (primary keys, data types, partitioning)
- Query optimization (JOINs, materialized views, indices)
- Insert strategy (batching, async inserts, avoiding mutations)

Each rule includes MooseStack TypeScript/Python examples. When reviewing or implementing ClickHouse-related code, read relevant rule files and cite specific rules in your guidance.

To install the skill: `npx skills add 514-labs/agent-skills`
