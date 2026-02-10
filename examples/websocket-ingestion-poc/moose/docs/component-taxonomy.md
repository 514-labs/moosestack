# Durable Ingest Component Taxonomy

Status: Draft taxonomy for MVP scope.

## Purpose
Define a shared vocabulary for the durable ingest component model so implementation, docs, and project planning use the same terms.
This taxonomy is also the copilot-facing contract for where to read, where to extend, and which invariants must hold.

## Core Components

### 1. Source
A long-running adapter that connects to an external system (websocket, API poll, or change feed), handles provider protocol details, and emits canonical envelopes.

Responsibilities:
- auth and connection setup
- subscription or polling
- provider error/disconnect handling
- emitting normalized events to runtime

Non-responsibilities:
- writing to Moose destinations
- runtime retry policy decisions

### 2. Source Envelope
Canonical event contract emitted by a source:
- `resource`
- `payload`
- optional `checkpoint`

Purpose:
- define the clean boundary between source logic and shared runtime
- ensure all connectors follow one handoff contract

### 3. Resource
A named routing unit (for example `projects`, `time_entries`, `matches`) resolved by the runtime.

A resource definition includes:
- `destination`: Moose `Stream` or `OlapTable`
- optional `transform(payload, envelope)`

### 4. Sink / Destination
The Moose write target for transformed records.

Allowed destination types in MVP:
- `Stream`
- `OlapTable`

### 5. Transform (Optional)
Per-resource mapping function:
- input: `payload`, `envelope`
- output: `record`, `record[]`, or `null`

Semantics:
- `null` drops event (no write, no checkpoint save)
- `record[]` enables fan-out
- omitted transform defaults to direct payload write when payload is record-like

### 6. Checkpoint
Durability cursor attached to an envelope that indicates resume position.

Guarantee:
- checkpoint persists only after successful sink write

### 7. Checkpoint Store
Persistence layer for checkpoints.

MVP default:
- MooseCache-backed store

### 8. Durable Runtime
Shared engine that processes envelopes and enforces durability semantics.

Responsibilities:
- sequential processing
- reconnect/backoff loop
- write-then-checkpoint ordering
- cancellation and cleanup behavior

### 9. Connector
Composition unit that wires:
- one source
- one resource map
- checkpoint store config
- workflow entrypoint

Purpose:
- source-specific setup with shared runtime behavior

### 10. Workflow Wrapper
Long-running workflow/task boundary (`timeout: "never"`) that starts and stops connector pipelines safely.

## Copilot Discovery Contract
To make extension easy for AI copilots and engineers, each connector should expose the same top-level structure:
1. `source.ts`: provider connection and envelope emission only.
2. `resources.ts`: resource-to-destination mapping plus optional transforms.
3. `pipeline.ts`: runtime wiring of source + resources + checkpoint store.
4. `workflow.ts`: long-running workflow/task entrypoint and cancellation behavior.

Required copilot extension flow:
1. Add or edit source protocol logic in `source.ts`.
2. Add or edit resource definitions in `resources.ts`.
3. Keep durability semantics unchanged in shared runtime (`write -> checkpoint`).
4. Add or update runtime/smoke tests for new resource behavior.

Required invariants for generated/copilot-authored changes:
1. At-least-once delivery preserved.
2. Checkpoint persists only after successful sink write.
3. Unknown resource fails clearly.
4. Transform output types stay within `null | record | record[]`.

## In-Scope Components for MVP
1. Shared durable runtime modules.
2. Source envelope contract.
3. Resource map and destination wiring.
4. Connector composition helpers.
5. Supabase example source implementation.
6. Coinbase example source implementation.
7. Beta docs and tests.

## Out-of-Scope Components for MVP
1. Registry install and `moose add` integration.
2. Production SLO and hardening surfaces.
3. Generic plugin marketplace behavior.

## Relationship to Component Registry Project
This taxonomy and runtime pattern define the artifact that the Component Registry project will package and install later.

Dependency:
- This project is blocked by registry packaging readiness.
- This project provides the first component set intended for registry distribution.
