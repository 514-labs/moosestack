---
title: Consider Starting Without Partitioning
impact: MEDIUM
impactDescription: "Add partitioning later when you have clear lifecycle requirements"
tags: [schema, partitioning, simplicity]
---

## Consider Starting Without Partitioning

**Impact: MEDIUM**

Start without partitioning and add it later only if:
- You have clear data lifecycle requirements (retention, archiving)
- Your access patterns clearly benefit from partition pruning
- You understand the cardinality implications

**Example (start simple):**

```sql
-- Start simple, no partitioning
CREATE TABLE events (
    timestamp DateTime,
    event_type LowCardinality(String),
    user_id UInt64
)
ENGINE = MergeTree()
ORDER BY (event_type, timestamp);

-- Add partitioning later if needed for lifecycle management
-- (requires table recreation or materialized view migration)
```

**MooseStack - Start simple (no partitioning):**

```typescript
import { Key, LowCardinality, UInt64, OlapTable } from "@514labs/moose-lib";

interface Event {
  id: Key<string>;
  timestamp: Date;
  eventType: string & LowCardinality;
  userId: UInt64;
}

// Start simple - no partitioning
export const eventsTable = new OlapTable<Event>("events", {
  orderByFields: ["eventType", "timestamp"]
  // No partitionBy - add later if needed for lifecycle management
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

# Start simple - no partitioning
events_table = OlapTable[Event]("events", {
    "order_by_fields": ["event_type", "timestamp"]
    # No partition_by - add later if needed for lifecycle management
})
```

**When to add partitioning:**

| Need | Add Partitioning? |
|------|-------------------|
| Time-based data retention | Yes |
| Archive old data to cold storage | Yes |
| Query performance on time ranges | Maybe (test first) |
| No specific lifecycle needs | No |

Reference: [Choosing a Partitioning Key](https://clickhouse.com/docs/best-practices/choosing-a-partitioning-key)
