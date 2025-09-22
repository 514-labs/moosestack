# Moose Repository Guide

This is a monorepo containing the Moose project, built with Rust, TypeScript, and Python. The project utilizes PNPM and Turbo for JavaScript/TypeScript package management and Cargo for Rust components. Please follow these guidelines when contributing:

## Code Standards

### Required Before Each Commit
- TypeScript/JavaScript: Run linting checks before submitting PRs
- Rust: Run `cargo clippy` to ensure code passes Clippy's linting standards
- Ensure all tests pass: `cargo test` for Rust components and appropriate test commands for TS/JS

### Development Flow
- Build TypeScript/JavaScript packages: `pnpm build`
- Build Rust components: `cargo build`
- Run tests:
  - Rust: `cargo test`
  - TypeScript/JavaScript: `pnpm test`
  - End-to-end tests: ./apps/framework-cli-e2e and then pnpm test
- Full CI check: Run appropriate build and test commands for affected packages

## Repository Structure
- `apps/`: Contains end-to-end tests for Moose, Moose the CLI, docs and some wrapper node packages for distribution
- `packages/`: Common internal dependencies shared across the monorepo as well as moose libs in python and typescript
- `templates/`: Standalone Moose templates that can be run in isolation
- Rust components with their own Cargo.toml files
- Configuration files for the monorepo:
  - `pnpm-workspace.yaml`: Defines PNPM workspace
  - `turbo.json`: Turbo Repo configuration
  - Various Rust configuration files

## Build System
- **JavaScript/TypeScript**: PNPM workspaces with Turbo Repo for build orchestration
- **Rust**: Cargo for managing Rust packages and dependencies
- **Cross-language**: Commands to build the entire monorepo or specific components

## Testing Strategy
- **Rust**: Unit and integration tests using Cargo's testing framework
- **TypeScript/JavaScript**: Unit tests for specific packages
- **End-to-end**: Full integration tests in the apps directory

## Key Guidelines
1. Follow the existing architecture and code organization
2. Respect language-specific best practices and idioms
3. Ensure cross-compatibility between components
4. Write tests for new functionality
5. Document public APIs and complex logic
6. When adding dependencies, ensure compatibility with the monorepo structure
7. For template modifications, verify they can still run in isolation
