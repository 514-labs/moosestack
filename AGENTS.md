# AGENTS.md

When you are changing MooseStack functionality (either in the language specific libraries or in the Rust core) ALWAYS run the
end-to-end tests to make sure you did not break anything.

When you change user facing functionality for moose, always add end-to-end tests for the `python-tests` and `typescript-tests`
templates and ALWAYS audit for the documentation for update needs. Those projects are Moose project that should be using Moose code.
The checks if the moose code works as expected should be inside `apps/framework-cli-e2e`. 

You can find the logs for moose if you need to troublehoot into `~/.moose/*-cli.log`

## Commands

### Build and Development
- **Build all packages**: `pnpm build` (uses Turbo Repo)
- **Development mode**: `pnpm dev` (starts development servers)
- **Linting**: `pnpm lint`
- **Formatting**: `pnpm format` (Prettier on TypeScript/JavaScript files)
- **Clean build artifacts**: `pnpm clean`

### Rust Components
- **Build Rust**: `cargo build`
- **Run Rust tests**: `cargo test`
- **Lint Rust code**: `cargo clippy --all-targets -- -D warnings` (no warnings allowed)
- **Format Rust code**: `rustfmt --edition 2021 <file.rs>`

### Testing

#### Unit Tests (Library Testing)
- **Rust tests**: `cargo test`
- **TypeScript library tests**: Navigate to `./packages/ts-moose-lib` and run `pnpm test`
- **Python library tests**: Navigate to `./packages/py-moose-lib` and run `pytest`

Unit tests should be colocated with the library code they test:
- TypeScript library tests: `packages/ts-moose-lib/tests/`
- Python library tests: `packages/py-moose-lib/tests/`
- Rust tests: Inline with code using `#[cfg(test)]` modules

#### End-to-End Tests (Template Integration Testing)
- **End-to-end tests**: Navigate to `./apps/framework-cli-e2e` and run `pnpm test`

End-to-end tests verify that complete MooseStack applications work correctly:
- Tests use the templates in `templates/` as working Moose applications
- Templates like `python-tests` and `typescript-tests` are complete MooseStack projects
- E2E tests verify infrastructure creation, data ingestion, API responses, etc.

#### Testing Distinction: Templates vs Libraries
**IMPORTANT**: Templates are NOT for library unit tests. They are working MooseStack applications.

- **Templates** (`templates/python-tests`, `templates/typescript-tests`): 
  - Complete, runnable Moose applications
  - Used by E2E tests to verify end-to-end functionality
  - Should demonstrate features and serve as examples
  - Tested by `apps/framework-cli-e2e`

- **Library Tests** (`packages/*/tests/`):
  - Unit tests for library functionality
  - Test individual functions, classes, and modules
  - Should be colocated with the library code
  - Run independently of the CLI or infrastructure

## Repository Architecture

### Monorepo Structure
This is a multi-language monorepo using:
- **PNPM workspaces** with **Turbo Repo** for JavaScript/TypeScript packages
- **Cargo workspace** for Rust components
- **Cross-language integration** between Rust CLI and TypeScript/Python libraries

### Key Directories
- `apps/`: End-to-end tests, CLI application, docs, and distribution packages
  - `framework-cli/`: Main Rust CLI application
  - `framework-docs/`: Documentation site
  - `framework-cli-e2e/`: End-to-end test suite
- `packages/`: Shared libraries and common dependencies
  - `ts-moose-lib/`: TypeScript library for MooseStack
  - `py-moose-lib/`: Python library for MooseStack
  - `protobuf/`: Protocol buffer definitions
- `templates/`: Standalone Moose project templates

### Core Technologies
- **Rust**: CLI application, performance-critical components
- **TypeScript**: Developer libraries, web interfaces
- **Python**: Alternative developer library
- **ClickHouse**: OLAP database
- **Redpanda/Kafka**: Streaming platform
- **Temporal**: Workflow orchestration
- **Redis**: Internal state management

### Architecture Patterns
- **Code-first infrastructure**: Declare tables, streams, APIs in code
- **Type-safe development**: Strong typing across TypeScript and Rust
- **Modular design**: Independent modules (OLAP, Streaming, Workflows, APIs)
- **Local-first development**: Full production mirror via `moose dev`

## Development Guidelines

### Pre-commit Requirements
- **TypeScript/JavaScript**: Must pass linting and code formating checks (`npx lint-staged`)
- **Rust**: Must pass `cargo clippy --all-targets -- -D warnings` (no warnings permitted)
- **All components**: Tests must pass before PR submission

### Error Handling (Rust)
- Define error types near their unit of fallibility (no global `Error` type)
- Use `thiserror` for error definitions with `#[derive(thiserror::Error)]`
- Structure errors in layers with context and specific variants
- Never use `anyhow::Result` - refactor to use `thiserror`

### Code Standards
- **Constants**: Use `const` in Rust, place in `constants.rs` at appropriate module level
- **Newtypes**: Use tuple structs with validation constructors
- **Documentation**: All public APIs must be documented
- **Linting**: Always run `cargo clippy --all-targets -- -D warnings` for Rust code
- Follow existing patterns and conventions in each language

### Templates
Templates in the `templates/` directory must be able to run in isolation. When modifying templates, verify they can still function as standalone projects.