---
title: Use Native Types Instead of String
impact: CRITICAL
impactDescription: "2-10x storage reduction; enables compression and correct semantics"
tags: [schema, data-types, storage]
---

## Use Native Types Instead of String

**Impact: CRITICAL**

Using String for all data wastes storage, prevents compression optimization, and makes comparisons slower. ClickHouse's column-oriented architecture benefits directly from optimal type selection.

**Incorrect (String for everything):**

```sql
CREATE TABLE events (
    event_id String,        -- "550e8400-e29b-41d4-a716-446655440000" = 36 bytes
    user_id String,         -- "12345" = 5 bytes (no numeric operations)
    created_at String,      -- "2024-01-15 10:30:00" = 19 bytes
    count String,           -- "42" - can't do math!
    is_active String        -- "true" = 4 bytes
)
```

**MooseStack - Incorrect (strings for everything):**

```typescript
// TypeScript - using strings loses type benefits
interface Event {
  eventId: string;      // String - 36 bytes for UUID
  userId: string;       // String - no numeric operations
  createdAt: string;    // String - 19 bytes, no date functions
  count: string;        // String - can't do math!
  isActive: string;     // String - 4 bytes for "true"
}
```

```python
# Python - using strings loses type benefits
class Event(BaseModel):
    event_id: str       # String - 36 bytes for UUID
    user_id: str        # String - no numeric operations
    created_at: str     # String - 19 bytes, no date functions
    count: str          # String - can't do math!
    is_active: str      # String - 4 bytes for "true"
```

**Correct (native types):**

```sql
CREATE TABLE events (
    event_id UUID DEFAULT generateUUIDv4(),     -- 16 bytes (vs 36)
    user_id UInt64,                              -- 8 bytes, numeric ops
    created_at DateTime DEFAULT now(),           -- 4 bytes (vs 19)
    count UInt32 DEFAULT 0,                      -- 4 bytes, math works
    is_active Bool DEFAULT true                  -- 1 byte (vs 4)
)
```

**MooseStack - Correct (native types):**

```typescript
import { UInt32, UInt64, ClickHouseDefault, OlapTable } from "@514labs/moose-lib";
import { tags } from "typia";

interface Event {
  eventId: string & tags.Format<"uuid">;                   // UUID - 16 bytes native storage
  userId: UInt64;                                          // UInt64 - 8 bytes, numeric ops
  createdAt: Date & ClickHouseDefault<"now()">;            // DateTime - 4 bytes
  count: UInt32 & ClickHouseDefault<"0">;                  // UInt32 - 4 bytes, math works
  isActive: boolean;                                       // Bool - 1 byte
}

export const eventsTable = new OlapTable<Event>("events");
```

```python
from typing import Annotated
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel
from moose_lib import OlapTable, clickhouse_default

class Event(BaseModel):
    event_id: UUID                                                  # UUID - 16 bytes native storage
    user_id: Annotated[int, "uint64"]                               # UInt64 - 8 bytes, numeric ops
    created_at: Annotated[datetime, clickhouse_default("now()")]    # DateTime - 4 bytes
    count: Annotated[int, "uint32", clickhouse_default("0")]        # UInt32 - 4 bytes, math works
    is_active: bool                                                 # Bool - 1 byte

events_table = OlapTable[Event]("events")
```

**MooseStack Type Mapping:**

| Data | TypeScript | Python |
|------|------------|--------|
| UUID | `string & tags.Format<"uuid">` (typia) | `UUID` (from uuid) |
| Sequential ID | `UInt32` / `UInt64` | `Annotated[int, "uint32"]` |
| Timestamps | `Date` | `datetime` |
| Counts | `UInt8` / `UInt16` / `UInt32` | `Annotated[int, "uint8"]` etc. |
| Money | `Decimal<P, S>` | `clickhouse_decimal(P, S)` |
| Booleans | `boolean` | `bool` |
| Enums | `enum Status { ... }` | `class Status(str, Enum)` |
| Low cardinality | `string & LowCardinality` | `Annotated[str, "LowCardinality"]` |

**Type Selection Quick Reference:**

| Data | Use | Avoid |
|------|-----|-------|
| Sequential IDs | UInt32/UInt64 | String |
| UUIDs | UUID | String |
| Status/Category | Enum8 or LowCardinality(String) | String |
| Timestamps | DateTime | DateTime64, String |
| Dates only | Date or Date32 | DateTime, String |
| Counts | UInt8/16/32 (smallest that fits) | Int64, String |
| Money | Decimal(P,S) or Int64 (cents) | Float64, String |
| Booleans | Bool or UInt8 | String |

Reference: [Select Data Types](https://clickhouse.com/docs/best-practices/select-data-types)
