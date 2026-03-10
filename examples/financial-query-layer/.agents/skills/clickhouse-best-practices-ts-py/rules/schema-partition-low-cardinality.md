---
title: Keep Partition Cardinality Low (100-1,000 Values)
impact: HIGH
impactDescription: "Too many partitions cause part explosion and 'too many parts' errors"
tags: [schema, partitioning, parts]
---

## Keep Partition Cardinality Low (100-1,000 Values)

**Impact: HIGH**

Too many distinct partition values create excessive data parts, eventually triggering "too many parts" errors. ClickHouse enforces limits via `max_parts_in_total` and `parts_to_throw_insert` settings.

**Incorrect (high cardinality partitioning):**

```sql
-- High cardinality = too many partitions
CREATE TABLE events (...)
ENGINE = MergeTree()
PARTITION BY user_id  -- Millions of partitions!
ORDER BY (timestamp);

-- Daily partitions can grow unbounded over years
CREATE TABLE logs (...)
ENGINE = MergeTree()
PARTITION BY toDate(timestamp)  -- 3650 partitions over 10 years
ORDER BY (service, timestamp);
```

**MooseStack - Incorrect (high cardinality partitioning):**

```typescript
// TypeScript - high cardinality partitioning causes "too many parts" errors
export const eventsTable = new OlapTable<Event>("events", {
  orderByFields: ["timestamp"],
  partitionBy: "userId"  // Millions of partitions - BAD!
});

export const logsTable = new OlapTable<Log>("logs", {
  orderByFields: ["service", "timestamp"],
  partitionBy: "toDate(timestamp)"  // 3650 partitions over 10 years - risky!
});
```

```python
# Python - high cardinality partitioning causes "too many parts" errors
events_table = OlapTable[Event]("events", {
    "order_by_fields": ["timestamp"],
    "partition_by": "user_id"  # Millions of partitions - BAD!
})

logs_table = OlapTable[Log]("logs", {
    "order_by_fields": ["service", "timestamp"],
    "partition_by": "toDate(timestamp)"  # 3650 partitions over 10 years - risky!
})
```

**Correct (bounded cardinality):**

```sql
-- Monthly partitions = 12 per year, bounded cardinality
CREATE TABLE events (
    timestamp DateTime,
    event_type LowCardinality(String),
    user_id UInt64
)
ENGINE = MergeTree()
PARTITION BY toStartOfMonth(timestamp)
ORDER BY (event_type, timestamp);
```

**MooseStack - Correct (bounded cardinality):**

```typescript
import { Key, LowCardinality, UInt64, OlapTable } from "@514labs/moose-lib";

interface Event {
  id: Key<string>;
  timestamp: Date;
  eventType: string & LowCardinality;
  userId: UInt64;
}

// Monthly partitions = 12 per year, bounded cardinality
export const eventsTable = new OlapTable<Event>("events", {
  orderByFields: ["eventType", "timestamp"],
  partitionBy: "toStartOfMonth(timestamp)"  // 12 partitions per year - GOOD!
});
```

```python
from typing import Annotated
from datetime import datetime
from pydantic import BaseModel
from moose_lib import Key, OlapTable

class Event(BaseModel):
    id: Key[str]
    timestamp: datetime
    event_type: Annotated[str, "LowCardinality"]
    user_id: Annotated[int, "uint64"]

# Monthly partitions = 12 per year, bounded cardinality
events_table = OlapTable[Event]("events", {
    "order_by_fields": ["event_type", "timestamp"],
    "partition_by": "toStartOfMonth(timestamp)"  # 12 partitions per year - GOOD!
})
```

**Validation:**

```sql
-- Check partition count and health
SELECT
    partition,
    count() as parts,
    sum(rows) as rows,
    formatReadableSize(sum(bytes_on_disk)) as size
FROM system.parts
WHERE table = 'events' AND active
GROUP BY partition
ORDER BY partition;

-- Warning signs: hundreds or thousands of partitions
```

Reference: [Choosing a Partitioning Key](https://clickhouse.com/docs/best-practices/choosing-a-partitioning-key)
