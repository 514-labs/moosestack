# Rust CLI Development Guide

## Overview
This directory contains the main Rust CLI application for Moose. Follow these standards for consistent, maintainable code.

## Development Commands
- **Build**: `cargo build`
- **Test**: `cargo test`
- **Lint**: `cargo clippy` (required before commits)
- **Format**: `rustfmt --edition 2021 <file.rs>`

## Code Quality Requirements
- **Always run `cargo clippy`** before commits - trust Clippy's guidance
- Use `rustfmt --edition 2021` for consistent formatting
- Write meaningful names: functions, variables, types
- Keep functions focused and modular
- Document all public APIs and breaking changes

## Error Handling (Critical)
- **NO** `anyhow::Result` - use `thiserror` crate instead
- Define errors near their unit of fallibility (no global Error types)
- Use `#[derive(thiserror::Error)]` with `#[error()]` messages
- Structure as: context struct + error enum + `#[source]` chaining

### Error Example
```rust
#[derive(Debug, thiserror::Error)]
#[error("failed to read `{path}`")]
pub struct FileError {
    pub path: PathBuf,
    #[source] pub kind: FileErrorKind
}
```

## Newtypes
- Define as tuple structs: `struct UserId(u64);`
- Add validation constructors: `UserId::new(id: u64) -> Result<Self, Error>`
- Derive standard traits: `#[derive(Debug, Clone, PartialEq)]`
- Implement `From`/`TryFrom` for conversions
- Use `derive_more` or `nutype` to reduce boilerplate

## Constants
- Use `const` for static values (prefer over `static`)
- Place in `constants.rs` at deepest common module level
- Use `UPPER_SNAKE_CASE` naming
- Scope visibility: `pub(crate)` > `pub(super)` > `pub`
- Group related constants together

## Testing
- Write unit tests for all public functions
- Use integration tests for CLI commands
- Test error conditions and edge cases
- Use `cargo test` to run all tests
