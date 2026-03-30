---
title: Use Partitioning for Data Lifecycle Management
impact: HIGH
impactDescription: "DROP PARTITION is instant; DELETE is expensive row-by-row scan"
tags: [schema, partitioning, TTL, data-management]
---

## Use Partitioning for Data Lifecycle Management

**Impact: HIGH**

Partitioning is **primarily a data management technique, not a query optimization tool**. It excels at:
- **Dropping data**: Remove entire partitions as single metadata operations
- **TTL retention**: Implement time-based retention policies efficiently
- **Tiered storage**: Move old partitions to cold storage
- **Archiving**: Move partitions between tables

**Incorrect (no time alignment for lifecycle):**

```sql
-- Cannot efficiently drop old data by time
CREATE TABLE events (...)
ENGINE = MergeTree()
PARTITION BY event_type  -- No time alignment
ORDER BY (timestamp);

-- Slow: must scan and delete row by row
DELETE FROM events WHERE timestamp < '2023-01-01';
```

**MooseStack - Incorrect (no time alignment):**

```typescript
// TypeScript - partitioning by eventType makes time-based cleanup slow
export const eventsTable = new OlapTable<Event>("events", {
  orderByFields: ["timestamp"],
  partitionBy: "eventType"  // Cannot efficiently drop old data by time
});
```

```python
# Python - partitioning by event_type makes time-based cleanup slow
events_table = OlapTable[Event]("events", {
    "order_by_fields": ["timestamp"],
    "partition_by": "event_type"  # Cannot efficiently drop old data by time
})
```

**Correct (time-based for lifecycle):**

```sql
CREATE TABLE events (
    timestamp DateTime,
    event_type LowCardinality(String)
)
ENGINE = MergeTree()
PARTITION BY toStartOfMonth(timestamp)
ORDER BY (event_type, timestamp)
TTL timestamp + INTERVAL 1 YEAR DELETE;  -- Drops whole partitions

-- Fast: metadata-only operation
ALTER TABLE events DROP PARTITION '202301';

-- Archive to cold storage
ALTER TABLE events_archive ATTACH PARTITION '202301' FROM events;
```

**MooseStack - Correct (time-based partitioning with TTL):**

```typescript
import { Key, LowCardinality, OlapTable } from "@514labs/moose-lib";

interface Event {
  id: Key<string>;
  timestamp: Date;
  eventType: string & LowCardinality;
}

export const eventsTable = new OlapTable<Event>("events", {
  orderByFields: ["eventType", "timestamp"],
  partitionBy: "toStartOfMonth(timestamp)",  // Monthly partitions for easy lifecycle management
  ttl: "timestamp + INTERVAL 1 YEAR DELETE"       // Auto-drop partitions older than 1 year
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

events_table = OlapTable[Event]("events", {
    "order_by_fields": ["event_type", "timestamp"],
    "partition_by": "toStartOfMonth(timestamp)",  # Monthly partitions for easy lifecycle management
    "ttl": "timestamp + INTERVAL 1 YEAR DELETE"         # Auto-drop partitions older than 1 year
})
```

Reference: [Choosing a Partitioning Key](https://clickhouse.com/docs/best-practices/choosing-a-partitioning-key)
