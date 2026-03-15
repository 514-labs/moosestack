# Draft Linear Project: Durable Ingest Component Beta (Websocket/API Sources)

Status: Draft only. Do not publish directly from this file.

## Project Name
Durable Ingest Component Beta (Websocket/API Sources)

## Owners
- Engineering
- Product Marketing

## Target Date
- MVP beta complete by **Friday, February 13, 2026**.

## Summary
Ship the first reusable Moose component pattern for durable long-running ingest as a public beta through examples and docs. This project delivers the first component set intended for registry distribution once registry packaging is ready.

## Strategic Positioning
This project maps to the `2026: Fun & Incremental Wins` initiative under the "As Code Everything" and "Components" bets.

Positioning statement:
- This is the first concrete component behavior pattern for ingest.
- It demonstrates a clean, extensible architecture for websocket/API sources.
- It uses Supabase Realtime as an example source without positioning it as traditional log-based CDC.

## Parent Initiative
- `2026: Fun & Incremental Wins` (`354c9bc1-cbfe-4948-857e-9885b2c728ab`)

## Dependency
This project should be marked as **blocked by**:
- `Moose Component Registry (TTPV & TTFV)` (`fe0eed3d-bccc-49b7-a653-9431c2aa7380`)

Reason:
- This project is the first component set planned for registry distribution.
- Registry packaging and install flows must be available before distribution can happen.

## Problem Statement
Connector implementations are hard to extend and hard to reason about. Users need an explicit, low-boilerplate way to define:
- source connection logic
- source-to-resource routing
- Moose destinations (`Stream`/`OlapTable`)
- durable runtime guarantees (reconnect, checkpoint-after-write, cancellation cleanup)

## Goals
1. Define and ship a clear component taxonomy for durable ingest.
2. Prove the pattern in public beta with concrete examples.
3. Reduce time to create a new connector for websocket/API sources.
4. Improve confidence in durability semantics through focused tests.

## Success Metrics
Primary:
1. Adoption (MVP): number of times the durable ingest component is copied from docs.
2. DX speed: median time from new source definition to first durable write.

Secondary:
1. Runtime confidence: durable runtime and example smoke tests remain green.
2. Documentation clarity: reduced support questions around source/resource/sink roles.
3. Adoption (post-registry): number of times component is added via `moose add`.

## In Scope (MVP)
1. Shared durable runtime primitives.
2. Canonical source envelope contract.
3. Resource map API with destination and optional transform.
4. Connector composition API for long-running workflows.
5. Supabase example connector.
6. Coinbase example connector.
7. Public beta docs and guide updates.
8. Focused runtime and smoke E2E tests.
9. Copilot developer enablement assets for discovery, extension, and contribution.

## Out of Scope (MVP)
1. `moose add` or registry install path.
2. Production hardening or SLO commitments.

## Component Taxonomy
Full taxonomy reference:
- `examples/websocket-ingestion-poc/moose/docs/component-taxonomy.md`

Short definitions:
- Source: connects to external provider and emits envelopes.
- Resource: named routing unit that maps to destination plus optional transform.
- Sink/Destination: Moose write target (`Stream` or `OlapTable`).
- Checkpoint: cursor persisted only after successful writes.
- Durable runtime: shared reconnect/process/checkpoint engine.

## AI Copilot Discovery and Development Plan
1. Publish one canonical entrypoint doc for the component architecture and extension flow, linked from the guide and example README.
2. Define a stable, explicit folder contract for connectors (`source`, `resources`, `pipeline`, `workflow`) so copilots can infer where changes belong.
3. Add a machine-readable component manifest describing source type, supported destinations, envelope schema, and extension points.
4. Add "how to add a new source in 30 minutes" instructions with copy-paste prompts that other copilots can follow.
5. Add contribution guardrails: required tests, durability invariants, and checklist for source/resource/sink changes.
6. Track copilot usability by measuring successful scaffold-to-write runs from documented copilot workflows.

## Milestones
1. M1: Taxonomy and API contract freeze.
2. M2: Example connectors aligned to one pattern.
3. M3: Docs, copilot-discovery assets, and onboarding polish for public beta.
4. M4: Verification gate and registry handoff package for first distributed components.

## Proposed Starter Issues
1. Finalize and publish taxonomy in docs.
2. Add negative-path runtime tests (unknown resource, invalid transform output).
3. Add "new source in <30 minutes" walkthrough and copilot prompt pack.
4. Add adoption instrumentation plan for example usage.
5. Define explicit integration handoff to `moose add` registry project as first distributed component set.
