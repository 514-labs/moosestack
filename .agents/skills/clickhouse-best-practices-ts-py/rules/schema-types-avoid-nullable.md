---
title: Avoid Nullable Unless Semantically Required
impact: HIGH
impactDescription: "Nullable adds storage overhead; use DEFAULT values instead"
tags: [schema, data-types, Nullable, DEFAULT]
---

## Avoid Nullable Unless Semantically Required

**Impact: HIGH**

Nullable columns maintain a separate UInt8 column for tracking null values, increasing storage and degrading performance. Use DEFAULT values instead when feasible.

**Incorrect (Nullable everywhere):**

```sql
CREATE TABLE users (
    id Nullable(UInt64),              -- IDs should never be null
    name Nullable(String),            -- Empty string is fine
    age Nullable(UInt8),              -- 0 is a valid default
    login_count Nullable(UInt32)      -- 0 is a valid default
)
```

**MooseStack - Incorrect (optional fields create Nullable):**

```typescript
// TypeScript - Optional fields become Nullable columns
interface User {
  id?: string;          // Nullable(String) - IDs should never be null!
  name?: string;        // Nullable(String) - empty string is fine
  age?: number;         // Nullable(Float64) - 0 is a valid default
  loginCount?: number;  // Nullable(Float64) - 0 is a valid default
}
```

```python
# Python - Optional fields become Nullable columns
from typing import Optional

class User(BaseModel):
    id: Optional[str] = None          # Nullable(String) - IDs should never be null!
    name: Optional[str] = None        # Nullable(String) - empty string is fine
    age: Optional[int] = None         # Nullable(Int64) - 0 is a valid default
    login_count: Optional[int] = None # Nullable(Int64) - 0 is a valid default
```

**Correct (DEFAULT values, Nullable only when semantic):**

```sql
CREATE TABLE users (
    id UInt64,                                    -- Never null
    name String DEFAULT '',                       -- Empty = unknown
    age UInt8 DEFAULT 0,                          -- 0 = unknown
    login_count UInt32 DEFAULT 0,                 -- 0 = never logged in
    deleted_at Nullable(DateTime),                -- NULL = not deleted (semantic!)
    parent_id Nullable(UInt64)                    -- NULL = no parent (semantic!)
)
```

**MooseStack - Correct (use ClickHouseDefault, Nullable only when semantic):**

```typescript
import { Key, ClickHouseDefault, UInt8, UInt32, UInt64, OlapTable } from "@514labs/moose-lib";

interface User {
  id: Key<UInt64>;                                         // Never null
  name: string & ClickHouseDefault<"''">;                  // DEFAULT '' - empty = unknown
  age: UInt8 & ClickHouseDefault<"0">;                     // DEFAULT 0 - 0 = unknown
  loginCount: UInt32 & ClickHouseDefault<"0">;             // DEFAULT 0 - 0 = never logged in
  deletedAt?: Date;                                        // Nullable - NULL = not deleted (semantic!)
  parentId?: UInt64;                                       // Nullable - NULL = no parent (semantic!)
}

export const usersTable = new OlapTable<User>("users");
```

```python
from typing import Optional, Annotated
from pydantic import BaseModel
from moose_lib import Key, OlapTable, clickhouse_default

class User(BaseModel):
    id: Key[int]                                                           # Never null
    name: Annotated[str, clickhouse_default("''")] = ""                    # DEFAULT '' - empty = unknown
    age: Annotated[int, "uint8", clickhouse_default("0")] = 0              # DEFAULT 0 - 0 = unknown
    login_count: Annotated[int, "uint32", clickhouse_default("0")] = 0     # DEFAULT 0 - 0 = never logged in
    deleted_at: Optional[datetime] = None                                  # Nullable - NULL = not deleted (semantic!)
    parent_id: Optional[int] = None                                        # Nullable - NULL = no parent (semantic!)

users_table = OlapTable[User]("users")
```

**When Nullable IS appropriate:**

| Use Case | Why |
|----------|-----|
| `deleted_at` | NULL = "not deleted", timestamp = "deleted at X" |
| `parent_id` | NULL = "no parent", value = "has parent" |
| `discount_percent` | NULL = "no discount", 0 = "0% discount" |

**Defaults instead of Nullable:**

| Type | Default |
|------|---------|
| String | `''` (empty string) |
| UInt*/Int* | `0` |
| DateTime | `now()` or `toDateTime(0)` |
| UUID | `generateUUIDv4()` |

**MooseStack Defaults Syntax:**

| Type | TypeScript | Python |
|------|------------|--------|
| String | `string & ClickHouseDefault<"''">` | `Annotated[str, clickhouse_default("''")]` |
| Number | `number & ClickHouseDefault<"0">` | `Annotated[int, clickhouse_default("0")]` |
| DateTime | `Date & ClickHouseDefault<"now()">` | `Annotated[datetime, clickhouse_default("now()")]` |

Reference: [Select Data Types](https://clickhouse.com/docs/best-practices/select-data-types)
