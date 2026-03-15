# Durable WebSocket Pipeline POC (Moose)

This example shows a websocket-focused durable ingestion SDK for implementing API connectors.

## Design goals

1. Define resources once in the source.
2. Keep source connection logic separate from sink writes.
3. Keep per-resource parsing/mapping explicit with `defineWebSocketResource(...)`.
4. Keep durability/reconnect/checkpoint-after-write in one shared runtime.

## Connector file layout

Each connector uses the same shape:

- `source.ts`: websocket connection/subscription logic and raw emission (`emitRaw(rawMessage)`).
- `resources/*.ts`: one resource per file (`defineWebSocketResource({ name, sink, parse, process })`).
- `pipeline.ts`: connector composition (`defineWebSocketConnector`, checkpoint store defaults).
- `workflow.ts`: long-running workflow export.

## Shared durable primitive

- `app/connectors/shared/durable-pipeline/runner.ts`
- `app/connectors/shared/durable-pipeline/types.ts`
- `app/connectors/shared/durable-pipeline/source-definition.ts`
- `app/connectors/shared/durable-pipeline/resource-definition.ts`
- `app/connectors/shared/durable-pipeline/checkpoint-store.ts`
- `app/connectors/shared/durable-pipeline/sink-writer.ts`
- `app/connectors/shared/durable-pipeline/connector-pipeline.ts`
- `app/connectors/shared/durable-pipeline/connector-definition.ts`
- `app/connectors/shared/durable-pipeline/pipeline-workflow.ts`
- `app/connectors/shared/durable-pipeline/backoff.ts`
- `app/connectors/shared/durable-pipeline/disconnect-signal.ts`
- `app/connectors/shared/durable-pipeline/event-processor.ts`
- `app/connectors/shared/durable-pipeline/run-loop.ts`

Delivery semantics: **at-least-once**

Checkpoint rule: save checkpoint **only after successful sink write**.

## Event processing contract

- Source emits raw provider messages with `emitRaw(rawMessage)`.
- Runtime iterates `source.resources` for each raw message.
- Runtime executes `resource.parse(rawMessage)`.
- For parsed payloads, runtime executes `resource.process({ payload, receivedAt })`.
- `process` returns:
  - `null` to drop payload
  - `{ records }` to write without checkpoint
  - `{ records, checkpoint }` to write and persist checkpoint after success

## Where to change what

- Source connectivity/auth/subscriptions:
  - `app/connectors/supabase/source.ts`
  - `app/connectors/coinbase/source.ts`
- Resource parse + sink mapping + checkpoint logic:
  - `app/connectors/supabase/resources/projects.ts`
  - `app/connectors/supabase/resources/time-entries.ts`
  - `app/connectors/coinbase/resources/matches.ts`
- Pipeline/workflow composition:
  - `app/connectors/supabase/pipeline.ts`
  - `app/connectors/supabase/workflow.ts`
  - `app/connectors/coinbase/pipeline.ts`
  - `app/connectors/coinbase/workflow.ts`

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

## Add a new websocket connector

1. Create `source.ts` with `defineWebSocketSource({ name, resources, start })`.
2. Create one file per resource under `resources/` with `defineWebSocketResource(...)`.
3. Keep `start(...)` focused on websocket session lifecycle and `emitRaw(...)` only.
4. Put parsing and sink mapping in `parse(...)`/`process(...)` inside resource files.
5. Compose `pipeline.ts` and `workflow.ts` with shared helpers.

## Structure

```text
app/
  connectors/
    shared/
      durable-pipeline/
        backoff.ts
        checkpoint-store.ts
        connector-definition.ts
        connector-pipeline.ts
        disconnect-signal.ts
        event-processor.ts
        pipeline-workflow.ts
        resource-definition.ts
        run-loop.ts
        runner.ts
        sink-writer.ts
        source-definition.ts
        types.ts
    supabase/
      pipeline.ts
      source.ts
      workflow.ts
      resources/
        projects.ts
        time-entries.ts
    coinbase/
      pipeline.ts
      source.ts
      workflow.ts
      resources/
        matches.ts
```
