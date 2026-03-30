---
title: Filter on ORDER BY Columns in Queries
impact: CRITICAL
impactDescription: "Skipping prefix columns prevents index usage"
tags: [schema, primary-key, WHERE, query]
---

## Filter on ORDER BY Columns in Queries

**Impact: CRITICAL**

Even with good schema design, queries must use ORDER BY columns to benefit. Skipping prefix columns or filtering on non-ORDER BY columns prevents index usage.

**Incorrect (skips prefix or uses non-ORDER BY columns):**

```sql
-- Given: ORDER BY (tenant_id, event_type, timestamp)

-- Skips prefix columns - can't use index effectively
SELECT * FROM events WHERE event_type = 'click';

-- Filter on column not in ORDER BY - full table scan
SELECT * FROM events WHERE user_agent LIKE '%Chrome%';
```

**MooseStack - Schema & Query Example:**

```typescript
import { Key, LowCardinality, OlapTable } from "@514labs/moose-lib";

interface Event {
  id: Key<string>;
  tenantId: number;
  eventType: string & LowCardinality;
  timestamp: Date;
  userAgent: string;  // Not in orderByFields
}

export const eventsTable = new OlapTable<Event>("events", {
  orderByFields: ["tenantId", "eventType", "timestamp"]  // Define ordering
});
```

```python
from moose_lib import Key, OlapTable
from typing import Annotated

class Event(BaseModel):
    id: Key[str]
    tenant_id: int
    event_type: Annotated[str, "LowCardinality"]
    timestamp: datetime
    user_agent: str  # Not in order_by_fields

events_table = OlapTable[Event]("events", {
    "order_by_fields": ["tenant_id", "event_type", "timestamp"]  # Define ordering
})
```

**Important:** MooseStack generates the ClickHouse schema, but you must still write queries that use the ORDER BY columns to benefit from the index.

**Correct (uses ORDER BY prefix):**

```sql
-- Given: ORDER BY (tenant_id, event_type, timestamp)

-- Full prefix match - best performance
SELECT * FROM events
WHERE tenant_id = 123 AND event_type = 'click';

-- Partial prefix - still uses index
SELECT * FROM events WHERE tenant_id = 123;

-- Range on later column after equality on earlier
SELECT * FROM events
WHERE tenant_id = 123 AND event_type = 'click' AND timestamp >= '2024-01-01';
```

**Index usage reference:**

| Filter | Index Used? |
|--------|-------------|
| `WHERE tenant_id = 123` | Full |
| `WHERE tenant_id = 123 AND event_type = 'click'` | Full |
| `WHERE event_type = 'click'` | None (skipped prefix) |
| `WHERE timestamp > '2024-01-01'` | None (skipped both) |

Reference: [Choosing a Primary Key](https://clickhouse.com/docs/best-practices/choosing-a-primary-key)
