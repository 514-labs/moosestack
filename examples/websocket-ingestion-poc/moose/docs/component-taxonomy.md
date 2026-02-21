# Durable Ingest Component Taxonomy

Status: Draft taxonomy for MVP scope.

## Purpose

Define a shared vocabulary for durable ingest so implementation, docs, and copilot usage all follow the same model.

## Core Components

### 1. Source

A long-running adapter that connects to an external system and emits source events.

- Declared with `defineSource(...)`
- Owns the canonical `resources` list
- Handles auth, connection, subscription/polling, and protocol errors
- Does not write to sinks

### 2. Resource

A named mapping unit declared with `defineResource(...)`.

- `name`: source resource key (for example `projects`, `time_entries`, `matches`)
- `sink`: Moose destination (`Stream` or `OlapTable`)
- `process`: maps payload to `{ records, checkpoint? } | null`

### 3. Source Event

The boundary between source and durable runtime.

- Shape: `{ resource, payload }`
- Emitted from `source.start(...).onEvent(...)`

### 4. Sink

Moose destination object for writes.

MVP supported sinks:
- `Stream`
- `OlapTable`

### 5. Checkpoint

Durability cursor returned by resource processing.

Guarantee:
- persisted only after successful sink write

### 6. Checkpoint Store

Persistence backend for checkpoints.

MVP default:
- MooseCache-backed store

### 7. Durable Runtime

Shared runtime that enforces:

- sequential processing
- reconnect/backoff
- write-then-checkpoint ordering
- cancellation cleanup

### 8. Connector Composition

Pipeline and workflow wiring for one source.

- `pipeline.ts`: `defineConnector(...)`, pipeline creation/start
- `workflow.ts`: long-running workflow export

## Copilot Discovery Contract

Each connector folder should expose:

1. `source.ts`
2. `resources/*.ts` (one resource per file)
3. `pipeline.ts`
4. `workflow.ts`

Extension flow:

1. Update source protocol logic in `source.ts`.
2. Add/update resource files in `resources/`.
3. Keep runtime durability invariants unchanged.
4. Add/update runtime and smoke tests.

Required invariants:

1. At-least-once delivery preserved.
2. Checkpoint persists only after successful sink write.
3. Unknown resource fails clearly.
4. `process` output is `null` or `{ records, checkpoint? }`.

## In-Scope Components for MVP

1. Shared durable runtime modules.
2. `defineSource` / `defineResource` contracts.
3. Source-owned resources with per-resource processing.
4. Supabase and Coinbase examples.
5. Beta docs and tests.

## Out-of-Scope Components for MVP

1. Registry install and `moose add` integration.
2. Production SLO hardening.
3. Marketplace/plugin packaging.
