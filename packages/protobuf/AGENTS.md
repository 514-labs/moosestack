# Protocol Buffers Development Guide

## Overview
This directory contains Protocol Buffer definitions for Moose. These `.proto` files define the data structures and APIs used across the system.

## Critical Rule: NO BREAKING CHANGES
**NEVER** make breaking changes to existing `.proto` files. This includes:
- Removing or renaming fields
- Changing field numbers or types  
- Changing message/service names in public APIs

## Development Commands
- **Lint**: `buf lint` (run before committing)
- **Breaking change check**: `buf breaking`
- **Generate code**: `buf generate`
- **Validate**: Test with sample data before merging

## Field Management
- Always use explicit field numbers (never rely on auto-assignment)
- Reserve removed field numbers: `reserved 2, 15, 9 to 11;`
- Reserve removed field names: `reserved "foo", "bar";`
- Use `optional` for all fields unless required by business logic

## Naming Conventions
- **Field names**: Use `snake_case` - `user_id`, `created_at`
- **Message/Service names**: Use `PascalCase` - `UserProfile`, `DataService`
- **Enum values**: Use `UPPER_SNAKE_CASE` - `STATUS_ACTIVE`, `TYPE_PREMIUM`

## Best Practices
- Document all messages and fields with comments
- Group related messages in the same file
- Use imports for shared types across files
- Version your API changes carefully
- Test generated code in target languages

## Deprecation Process
Instead of removing fields:
1. Mark field as `deprecated = true`
2. Add comment explaining replacement
3. Update documentation
4. Plan removal for next major version

## Example
```proto
syntax = "proto3";

message UserProfile {
  // Unique identifier for the user
  uint64 user_id = 1;
  
  // User's display name
  string display_name = 2;
  
  // Deprecated: use display_name instead
  string name = 3 [deprecated = true];
  
  // Account creation timestamp
  google.protobuf.Timestamp created_at = 4;
}
```
