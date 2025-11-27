---
title: TypeScript Data Constraints
description: Define data validation rules and constraints for schema enforcement
priority: 0.70
category: data-validation
language: typescript
---

## Table Configuration Constraints

### Key Requirements
- Primary keys are optional in ClickHouse; only `ORDER BY` is required
- You can define primary keys in three ways:
  1. Use `Key<T>` on a top-level field (automatically becomes primary key)
  2. Use `primaryKeyExpression` in table config (most flexible, overrides `Key<T>`)
  3. Don't specify a primary key at all (only `ORDER BY` is used)
- If using `Key<T>`, it must be the first field in `orderByFields` when specified
- If using `primaryKeyExpression`, it overrides column-level `Key<T>` definitions
- `primaryKeyExpression` supports functions and custom column ordering

### OrderByFields Requirements
- Fields used in `orderByFields` must exist on the top level schema
- No optional fields in orderByFields (fields with ?)

## Schema Design Constraints
- No optional objects or custom types
- No tuples
- No union types
- No mapped types
- No complex TypeScript types
- Large integers must be stored as strings

## Pipeline Configuration Constraints

### Stream Configuration
- `parallelism` must be positive integer (use default unless you have specific scaling requirements)
- `retentionPeriod` must be in seconds (use default unless you have specific data retention needs)
- `destination` must be valid `OlapTable` instance
- Recommended to use `stream: true` instead of custom configuration unless specific requirements exist

### Ingest Configuration
- `destination` must be valid `Stream` instance

## Type System Constraints

### Supported Types Only
- `string` → String
- `number` → Float64
- `boolean` → Boolean
- `Date` → DateTime
- `Object` → Nested
- `Array` → Array
- `T?` → Nullable (optional fields using key?: value syntax)
- `Enum` → Enum
- `Key<T>` → Same as T

### Unsupported Types -- Do not use
- `any`
- Union types
- `undefined`
- `null` as direct type
- `symbol`
- `bigint`
- Complex TypeScript types (tuples, mapped types, Record)
- Types not listed in supported types

### Optional Field Restrictions -- Do not use
- Objects
- Nested arrays
- Optional Custom types

### Nullable Array Constraints
- Nested arrays cannot be nullable in ClickHouse tables
- For schemas with nullable nested arrays:
  - You must disable table creation in the pipeline (`table: false`)
  - You can still use streams and ingest APIs
  - Create a streaming function to a valid table schema
  - Example error: "Nested type Array(String) cannot be inside Nullable type"
