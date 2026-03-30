---
title: Understand Partition Query Performance Trade-offs
impact: MEDIUM
impactDescription: "Partition pruning helps some queries; spanning many partitions hurts others"
tags: [schema, partitioning, query, performance]
---

## Understand Partition Query Performance Trade-offs

**Impact: MEDIUM**

Partitioning can help or hurt query performance:
- **Potential improvement**: Queries filtering by partition key may benefit from partition pruning
- **Potential degradation**: Queries spanning many partitions increase total parts scanned

ClickHouse automatically builds **MinMax indexes** on partition columns. Data merges occur **within partitions only**, not across them.

**Incorrect (query scans all partitions):**

```sql
-- Query must scan all partitions
SELECT count(*) FROM events
WHERE event_type = 'click';  -- No partition pruning
```

**Correct (query prunes to single partition):**

```sql
-- Query prunes to single partition
SELECT count(*) FROM events
WHERE timestamp >= '2024-01-01' AND timestamp < '2024-02-01'
  AND event_type = 'click';
```

**MooseStack - Schema setup for partition pruning:**

```typescript
import { Key, LowCardinality, OlapTable } from "@514labs/moose-lib";

interface Event {
  id: Key<string>;
  timestamp: Date;
  eventType: string & LowCardinality;
}

// Define table with time-based partitioning
export const eventsTable = new OlapTable<Event>("events", {
  orderByFields: ["eventType", "timestamp"],
  partitionBy: "toStartOfMonth(timestamp)"
});

// Queries with timestamp filters will benefit from partition pruning
// Queries without timestamp filters will scan all partitions
```

```python
from moose_lib import Key, OlapTable
from typing import Annotated

class Event(BaseModel):
    id: Key[str]
    timestamp: datetime
    event_type: Annotated[str, "LowCardinality"]

# Define table with time-based partitioning
events_table = OlapTable[Event]("events", {
    "order_by_fields": ["event_type", "timestamp"],
    "partition_by": "toStartOfMonth(timestamp)"
})

# Queries with timestamp filters will benefit from partition pruning
# Queries without timestamp filters will scan all partitions
```

**Note:** MooseStack generates the schema - you still need to write efficient queries that include partition key filters.

Reference: [Choosing a Partitioning Key](https://clickhouse.com/docs/best-practices/choosing-a-partitioning-key)
