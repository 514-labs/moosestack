# Moose Template Capabilities

This document defines the capability vocabulary for Moose templates. Each template declares which capabilities it supports via a `moose.capabilities.json` file. Test scenarios declare which capabilities they require, enabling automatic matching of scenarios to compatible templates.

## Capability Categories

### Language Capabilities

| Capability | Description |
|------------|-------------|
| `lang:typescript` | Template uses TypeScript |
| `lang:python` | Template uses Python |

### Infrastructure Capabilities

| Capability | Description |
|------------|-------------|
| `infra:clickhouse` | Uses ClickHouse for OLAP storage |
| `infra:redpanda` | Uses Redpanda/Kafka for streaming |
| `infra:redis` | Uses Redis for state management |
| `infra:temporal` | Uses Temporal for workflows |

### Feature Capabilities

| Capability | Description |
|------------|-------------|
| `feature:ingestion` | Supports data ingestion endpoints |
| `feature:consumption` | Supports consumption/API endpoints |
| `feature:streaming-functions` | Supports streaming function transformations |
| `feature:blocks` | Supports block-based aggregations |
| `feature:workflows` | Supports Temporal workflows |
| `feature:dmv2` | Uses Data Model v2 syntax |
| `feature:materialized-views` | Uses materialized views |

### Model Capabilities

| Capability | Description |
|------------|-------------|
| `model:Foo` | Template defines a model named "Foo" |
| `model:Bar` | Template defines a model named "Bar" |
| `model:*` | Template defines at least one model (wildcard) |

## Manifest Schema

Templates declare capabilities in `moose.capabilities.json`:

```json
{
  "$schema": "../docs/e2e-v2/capabilities.schema.json",
  "capabilities": [
    "lang:typescript",
    "infra:clickhouse",
    "infra:redpanda",
    "feature:ingestion",
    "feature:streaming-functions",
    "model:Foo",
    "model:Bar"
  ],
  "testPort": 4010
}
```

### Schema Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `capabilities` | `string[]` | Yes | List of capability identifiers |
| `testPort` | `number` | No | Port to use when testing (avoids conflicts) |
| `skipScenarios` | `string[]` | No | Scenario names to skip for this template |

## Scenario Requirements

Test scenarios declare required capabilities:

```typescript
// scenarios/ingest-and-query.scenario.ts
export const scenario = {
  name: "ingest-and-query",
  description: "Basic ingestion and query verification",
  requires: [
    "feature:ingestion",
    "infra:clickhouse",
    "model:*"  // Any model will do
  ],
  // ...
};
```

## Matching Rules

1. A scenario runs against a template if ALL required capabilities are present
2. Wildcard capabilities (ending in `*`) match any capability with that prefix
3. Templates can skip specific scenarios via `skipScenarios`

## Example Configurations

### typescript-tests template
```json
{
  "capabilities": [
    "lang:typescript",
    "infra:clickhouse",
    "infra:redpanda",
    "feature:ingestion",
    "feature:consumption",
    "feature:streaming-functions",
    "feature:dmv2",
    "model:Foo",
    "model:Bar"
  ],
  "testPort": 4010
}
```

### python-tests template
```json
{
  "capabilities": [
    "lang:python",
    "infra:clickhouse",
    "infra:redpanda",
    "feature:ingestion",
    "feature:streaming-functions",
    "model:Foo",
    "model:Bar"
  ],
  "testPort": 4011
}
```

### typescript-empty template
```json
{
  "capabilities": [
    "lang:typescript",
    "infra:clickhouse",
    "infra:redpanda",
    "feature:ingestion"
  ],
  "testPort": 4012,
  "skipScenarios": ["streaming-functions"]
}
```

## Adding New Capabilities

When adding a new capability:

1. Add it to this document with a clear description
2. Update the JSON schema if needed
3. Add it to relevant template manifests
4. Update scenarios that should require it
