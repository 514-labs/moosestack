---
title: Plan PRIMARY KEY Before Table Creation
impact: CRITICAL
impactDescription: "ORDER BY is immutable; wrong choice requires full data migration"
tags: [schema, primary-key, ORDER BY]
---

## Plan PRIMARY KEY Before Table Creation

**Impact: CRITICAL** (immutable after creation)

ClickHouse's ORDER BY clause defines physical data ordering and the sparse index. Unlike other databases, **ORDER BY cannot be modified after table creation**. A wrong choice requires creating a new table and migrating all data.

**Incorrect (arbitrary ORDER BY without query analysis):**

```sql
-- Creating table without analyzing query patterns
CREATE TABLE events (
    event_id UUID,
    user_id UInt64,
    timestamp DateTime
)
ENGINE = MergeTree()
ORDER BY (event_id);  -- Chosen arbitrarily

-- Later: "Most queries filter by user_id!"
-- Cannot fix with: ALTER TABLE events MODIFY ORDER BY (user_id, timestamp)
-- ERROR: Cannot modify ORDER BY
```

**MooseStack - Incorrect (arbitrary orderByFields):**

```typescript
// TypeScript - ordering chosen arbitrarily without query analysis
interface Event {
  eventId: Key<string>;
  userId: number;
  timestamp: Date;
}

export const eventsTable = new OlapTable<Event>("events", {
  orderByFields: ["eventId"]  // Chosen arbitrarily - will require data migration to fix!
});
```

```python
# Python - ordering chosen arbitrarily without query analysis
class Event(BaseModel):
    event_id: Key[str]
    user_id: int
    timestamp: datetime

events_table = OlapTable[Event]("events", {
    "order_by_fields": ["event_id"]  # Chosen arbitrarily - will require data migration to fix!
})
```

**Correct (query-driven ORDER BY selection):**

```sql
-- Step 1: Document query patterns BEFORE creating table
/*
Query Analysis:
- 60% of queries: WHERE user_id = ? AND timestamp BETWEEN ? AND ?
- 25% of queries: WHERE event_type = ? AND timestamp > ?
- 15% of queries: WHERE event_id = ?

Conclusion: user_id and event_type are primary filters
*/

-- Step 2: Create table with correct ORDER BY
CREATE TABLE events (
    event_id UUID DEFAULT generateUUIDv4(),
    user_id UInt64,
    event_type LowCardinality(String),
    timestamp DateTime,
    event_date Date DEFAULT toDate(timestamp)
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(event_date)
ORDER BY (user_id, event_date, event_id);
```

**MooseStack - Correct (query-driven orderByFields):**

```typescript
import { Key, LowCardinality, UInt64, OlapTable, ClickHouseDefault } from "@514labs/moose-lib";

/*
Query Analysis:
- 60% of queries: WHERE userId = ? AND timestamp BETWEEN ? AND ?
- 25% of queries: WHERE eventType = ? AND timestamp > ?
- 15% of queries: WHERE eventId = ?

Conclusion: userId is the primary filter
*/

interface Event {
  eventId: Key<string>;
  userId: UInt64;
  eventType: string & LowCardinality;
  timestamp: Date;
  eventDate: Date & ClickHouseDefault<"toDate(timestamp)">;
}

export const eventsTable = new OlapTable<Event>("events", {
  orderByFields: ["userId", "eventDate", "eventId"],  // Matches query patterns
  partitionBy: "toYYYYMM(eventDate)"
});
```

```python
from typing import Annotated
from datetime import date, datetime
from pydantic import BaseModel
from moose_lib import Key, OlapTable, clickhouse_default

"""
Query Analysis:
- 60% of queries: WHERE user_id = ? AND timestamp BETWEEN ? AND ?
- 25% of queries: WHERE event_type = ? AND timestamp > ?
- 15% of queries: WHERE event_id = ?

Conclusion: user_id is the primary filter
"""

class Event(BaseModel):
    event_id: Key[str]
    user_id: Annotated[int, "uint64"]
    event_type: Annotated[str, "LowCardinality"]
    timestamp: datetime
    event_date: Annotated[date, clickhouse_default("toDate(timestamp)")]

events_table = OlapTable[Event]("events", {
    "order_by_fields": ["user_id", "event_date", "event_id"],  # Matches query patterns
    "partition_by": "toYYYYMM(event_date)"
})
```

**Pre-creation checklist:**
- [ ] Listed top 5-10 query patterns
- [ ] Identified columns in WHERE clauses with frequency
- [ ] Prioritized columns that exclude large numbers of rows
- [ ] Ordered columns by cardinality (low first, high last)
- [ ] Limited to 4-5 key columns (typically sufficient)

Reference: [Choosing a Primary Key](https://clickhouse.com/docs/best-practices/choosing-a-primary-key)
