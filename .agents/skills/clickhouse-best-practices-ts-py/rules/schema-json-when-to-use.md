---
title: Use JSON Type for Dynamic Schemas
impact: MEDIUM
impactDescription: "Field-level querying for semi-structured data; use typed columns for known schemas"
tags: [schema, JSON, semi-structured, flexibility]
---

## Use JSON Type for Dynamic Schemas

**Impact: MEDIUM**

ClickHouse's JSON type splits JSON objects into separate sub-columns, enabling field-level query optimization. Use it for truly dynamic data, not everything.

**Incorrect (schema bloat or opaque String):**

```sql
-- BAD: Hundreds of nullable columns for event properties
CREATE TABLE events (
    event_id UUID,
    prop_page_url Nullable(String),
    prop_button_id Nullable(String),
    -- ... 100 more nullable columns
)

-- BAD: JSON as String when you need field queries
CREATE TABLE events (
    event_id UUID,
    properties String  -- No field-level optimization
)
```

**MooseStack - Incorrect (schema bloat or opaque String):**

```typescript
// TypeScript - BAD: Hundreds of nullable columns for event properties
interface Event {
  eventId: Key<string>;
  propPageUrl?: string;
  propButtonId?: string;
  // ... 100 more optional fields - maintenance nightmare!
}

// TypeScript - BAD: JSON stored as opaque string
interface Event {
  eventId: Key<string>;
  properties: string;  // No field-level optimization
}
```

```python
# Python - BAD: Hundreds of nullable columns for event properties
class Event(BaseModel):
    event_id: Key[str]
    prop_page_url: Optional[str] = None
    prop_button_id: Optional[str] = None
    # ... 100 more optional fields - maintenance nightmare!

# Python - BAD: JSON stored as opaque string
class Event(BaseModel):
    event_id: Key[str]
    properties: str  # No field-level optimization
```

**Correct (JSON for dynamic, typed for known):**

```sql
-- Use JSON type for dynamic properties
CREATE TABLE events (
    event_id UUID DEFAULT generateUUIDv4(),
    event_type LowCardinality(String),
    timestamp DateTime DEFAULT now(),
    properties JSON  -- Flexible schema with type inference
)
ENGINE = MergeTree()
ORDER BY (event_type, timestamp);

-- Query JSON paths directly
SELECT
    event_type,
    properties.url as page_url,
    properties.amount as purchase_amount
FROM events
WHERE event_type = 'page_view' AND properties.url = '/home';
```

**MooseStack - Correct (JSON type for dynamic properties):**

```typescript
import { Key, LowCardinality, OlapTable, ClickHouseDefault } from "@514labs/moose-lib";

interface Event {
  eventId: Key<string>;
  eventType: string & LowCardinality;
  timestamp: Date & ClickHouseDefault<"now()">;
  properties: Record<string, any>;  // Maps to JSON type in ClickHouse
}

export const eventsTable = new OlapTable<Event>("events", {
  orderByFields: ["eventType", "timestamp"]
});

// Query JSON paths directly in your SQL:
// SELECT event_type, properties.url as page_url FROM events WHERE properties.url = '/home'
```

```python
from typing import Dict, Any, Annotated
from datetime import datetime
from pydantic import BaseModel
from moose_lib import Key, OlapTable, clickhouse_default

class Event(BaseModel):
    event_id: Key[str]
    event_type: Annotated[str, "LowCardinality"]
    timestamp: Annotated[datetime, clickhouse_default("now()")]
    properties: Dict[str, Any]  # Maps to JSON type in ClickHouse

events_table = OlapTable[Event]("events", {
    "order_by_fields": ["event_type", "timestamp"]
})

# Query JSON paths directly in your SQL:
# SELECT event_type, properties.url as page_url FROM events WHERE properties.url = '/home'
```

**When to use JSON:**

| Scenario | Use JSON? |
|----------|-----------|
| Data structure varies unpredictably | Yes |
| Field types/schemas change over time | Yes |
| Need field-level querying | Yes |
| Fixed, known schema | No (use typed columns) |
| JSON as opaque blob (no field queries) | No (use String) |

**Optimization: specify types for known paths:**

```sql
CREATE TABLE events (
    properties JSON(
        url String,
        amount Float64,
        product_id UInt64
    )
)
```

Reference: [Use JSON Where Appropriate](https://clickhouse.com/docs/best-practices/use-json-where-appropriate)
