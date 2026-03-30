# MooseStack ClickHouse Best Practices

Agent skill providing comprehensive ClickHouse guidance for MooseStack applications covering data model design, query optimization, and data ingestion. Each rule includes TypeScript and Python examples.

> Forked from [ClickHouse/agent-skills](https://github.com/ClickHouse/agent-skills) with MooseStack-specific examples added.

## Installation

```bash
npx add-skill 514-labs/moose-agent-skills
```

## What's Included

**28 atomic rules** organized by prefix, each with MooseStack TypeScript and Python examples:

| Prefix | Count | Coverage |
|--------|-------|----------|
| `schema-pk-*` | 4 | `orderByFields` selection, cardinality ordering |
| `schema-types-*` | 5 | Type annotations (`Key`, `UInt64`, `LowCardinality`) |
| `schema-partition-*` | 4 | `partitionByField`, TTL, lifecycle management |
| `schema-json-*` | 1 | `Record<string, any>` / `Dict[str, Any]` usage |
| `query-join-*` | 5 | JOIN algorithms, filtering, MaterializedView alternatives |
| `query-index-*` | 1 | Skipping `indexes` in OlapTable |
| `query-mv-*` | 2 | `MaterializedView` incremental and refreshable |
| `insert-batch-*` | 1 | `IngestPipeline` and batch sizing |
| `insert-async-*` | 2 | Stream-based ingestion, data formats |
| `insert-mutation-*` | 2 | `ReplacingMergeTree`, `CollapsingMergeTree` engines |
| `insert-optimize-*` | 1 | OPTIMIZE FINAL avoidance |

## Trigger Phrases

This skill activates when you:
- "Create a MooseStack data model for..."
- "Define an OlapTable for..."
- "Optimize this query..."
- "Design a schema for..."
- "Why is this query slow?"
- "Set up an IngestPipeline for..."
- "Should I use UPDATE or ReplacingMergeTree?"
- "Create a MaterializedView for..."

## Files

| File | Purpose |
|------|---------|
| `SKILL.md` | Quick reference and decision frameworks |
| `AGENTS.md` | Complete rule reference (auto-generated) |
| `rules/*.md` | Individual rule definitions with TS/PY examples |

## MooseStack Key Patterns

**TypeScript Data Models:**
```typescript
import { Key, OlapTable, UInt64, LowCardinality } from "@514labs/moose-lib";

interface Event {
  id: Key<string>;
  userId: UInt64;
  eventType: string & LowCardinality;
  timestamp: Date;
}

export const eventsTable = new OlapTable<Event>("events", {
  orderByFields: ["eventType", "timestamp", "id"]
});
```

**Python Data Models:**
```python
from moose_lib import Key, OlapTable
from pydantic import BaseModel
from typing import Annotated

class Event(BaseModel):
    id: Key[str]
    user_id: Annotated[int, "uint64"]
    event_type: Annotated[str, "LowCardinality"]
    timestamp: datetime

events_table = OlapTable[Event]("events", {
    "order_by_fields": ["event_type", "timestamp", "id"]
})
```

## Related Documentation

- [MooseStack Documentation](https://docs.fiveonefour.com/moosestack)
- [ClickHouse Best Practices](https://clickhouse.com/docs/best-practices)
