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
- **Test all**: `cargo test`
- **Test single**: `cargo test <test_name>` or `cargo test --package <package_name> --test <test_file>`
- **Lint**: `cargo clippy --all-targets -- -D warnings` (REQUIRED pre-commit, no warnings allowed)
- **Format**: `rustfmt --edition 2021 <file.rs>`

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
- **Types**: Use type hints for function signatures and public APIs
- **Tests**: Use pytest with fixtures and parametrize decorators

## Repository Structure

- **`apps/`**: CLI (`framework-cli/`), docs (`framework-docs/`), E2E tests (`framework-cli-e2e/`)
- **`packages/`**: Libraries (`ts-moose-lib/`, `py-moose-lib/`), shared deps, protobuf definitions
- **`templates/`**: Standalone Moose apps used by E2E tests (NOT for unit tests)

## Testing Philosophy

- **Library tests** (`packages/*/tests/`): Unit tests colocated with library code
- **Templates** (`templates/python-tests`, `templates/typescript-tests`): Complete Moose apps for E2E testing; must run in isolation

## Key Technologies

Rust (CLI), TypeScript (libs/web), Python (lib), ClickHouse (OLAP), Redpanda/Kafka (streaming), Temporal (workflows), Redis (state)