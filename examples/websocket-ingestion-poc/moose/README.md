# Durable Pipeline POC (Moose)

This example shows a clean, reusable connector API for durable ETL across websocket and non-websocket sources.

## Design goals

1. Make sink wiring explicit at pipeline instantiation.
2. Keep source-specific logic isolated.
3. Keep transform optional and local to each resource mapping.
4. Keep durability/reconnect/checkpoint-after-write in one shared runtime.

## Connector file layout

Each connector uses the same shape:

- `sinks.ts`: Moose destinations and source-key -> destination object mapping.
- `source.ts`: source connection/subscription/fetch logic and canonical envelope emission (`resource`, `payload`, `checkpoint`).
- `connector.ts`: single composition point (env + pipeline + workflow wiring).
- `types.ts`: connector source envelope/checkpoint/record types.

## Shared durable primitive

- `app/connectors/shared/durable-pipeline/runner.ts`
- `app/connectors/shared/durable-pipeline/types.ts`
- `app/connectors/shared/durable-pipeline/checkpoint-store.ts`
- `app/connectors/shared/durable-pipeline/sink-writer.ts`
- `app/connectors/shared/durable-pipeline/connector-pipeline.ts`
- `app/connectors/shared/durable-pipeline/connector-definition.ts`
- `app/connectors/shared/durable-pipeline/source-definition.ts`
- `app/connectors/shared/durable-pipeline/pipeline-workflow.ts`
- `app/connectors/shared/durable-pipeline/backoff.ts`
- `app/connectors/shared/durable-pipeline/disconnect-signal.ts`
- `app/connectors/shared/durable-pipeline/event-processor.ts`
- `app/connectors/shared/durable-pipeline/run-loop.ts`

Delivery semantics: **at-least-once**

Checkpoint rule: save checkpoint **only after successful sink write**.

Connector composition helpers:

- `defineConnector(...)`: reusable connector factory (`createPipeline`, `startPipeline`, `workflow`).
- `defineSource(...)`: explicit source contract wrapper for `start({ fromCheckpoint, onEvent, onDisconnect, signal })`.
- `createConnectorPipeline(...)`: reusable pipeline config assembly.
- `createLongRunningPipelineWorkflow(...)`: reusable workflow/task wrapper with cleanup.

Event processing contract:

- Source emits `SourceEnvelope { resource, payload, checkpoint? }`.
- Runtime resolves `resources[resource]`.
- `resource.transform?(payload, envelope)` is optional:
  - `null` drops event (no write, no checkpoint save)
  - `record` writes one row
  - `record[]` writes fan-out rows
- If no `transform` exists, runtime writes `payload` directly (payload must be record/record[]).
- Checkpoint persists only after successful writes.

## Where to change what

- Destination objects and sink routing:
  - `app/connectors/supabase/sinks.ts`
  - `app/connectors/coinbase/sinks.ts`
- Source connectivity/auth/subscriptions:
  - `app/connectors/supabase/source.ts`
  - `app/connectors/coinbase/source.ts`
- Resource routing and optional transform:
  - `app/connectors/supabase/sinks.ts`
  - `app/connectors/coinbase/sinks.ts`
- Pipeline/workflow instantiation and env wiring:
  - `app/connectors/supabase/connector.ts`
  - `app/connectors/coinbase/connector.ts`

## Instantiating with custom resources

Pipelines accept options so destination logic is configured at instantiation time:

- `createSupabasePipeline({ resources, checkpointStore })`
- `createCoinbasePipeline({ resources, checkpointStore })`

Each `resources` entry defines:

- `destination`: Moose `Stream` or `OlapTable`
- optional `transform(payload, envelope)` for custom mapping/fan-out/drop

## Run locally

```bash
cd examples/websocket-ingestion-poc/moose
npm install
moose dev
```

### Supabase workflow

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<service-role-key>"
export SUPABASE_SCHEMA="public"
moose workflow run supabase-cdc-listener
```

### Coinbase workflow

```bash
export COINBASE_PRODUCTS="BTC-USD,ETH-USD"
export COINBASE_WS_URL="wss://ws-feed.exchange.coinbase.com"
moose workflow run coinbase-trades-listener
```

## Add a new source connector

1. Copy one connector folder (`supabase` or `coinbase`) to a new source folder.
2. Define sinks in `sinks.ts`.
3. Emit canonical envelopes in `source.ts`.
4. Add optional per-resource transforms in `sinks.ts` only when needed.
5. Compose env + pipeline + workflow in `connector.ts`.

This applies to websocket feeds, polling APIs, and database change streams.

## Structure

```text
app/
  connectors/
    shared/
      durable-pipeline/
        checkpoint-store.ts
        backoff.ts
        connector-definition.ts
        connector-pipeline.ts
        disconnect-signal.ts
        event-processor.ts
        pipeline-workflow.ts
        run-loop.ts
        runner.ts
        source-definition.ts
        sink-writer.ts
        types.ts
    supabase/
      connector.ts
      sinks.ts
      source.ts
      supabase.generated.ts
      types.ts
    coinbase/
      connector.ts
      sinks.ts
      source.ts
      types.ts
```
