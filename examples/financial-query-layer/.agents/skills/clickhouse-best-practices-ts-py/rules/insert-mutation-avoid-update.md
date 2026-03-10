---
title: Avoid ALTER TABLE UPDATE
impact: CRITICAL
impactDescription: "Mutations rewrite entire parts; use ReplacingMergeTree instead"
tags: [insert, mutation, UPDATE, ReplacingMergeTree]
---

## Avoid ALTER TABLE UPDATE

**Impact: CRITICAL**

`ALTER TABLE UPDATE` is a mutation - an asynchronous background process that rewrites entire data parts affected by the change. This is extremely expensive for frequent or large-scale operations.

**Why mutations are problematic:**
- **Write amplification:** Rewrite complete parts even for minor changes
- **Disk I/O spike:** Degrades overall cluster performance
- **No rollback:** Cannot be rolled back after submission
- **Inconsistent reads:** SELECT may read mix of mutated and unmutated parts

**Incorrect (mutation for updates):**

```sql
-- Rewrites potentially huge amounts of data
ALTER TABLE users UPDATE status = 'inactive'
WHERE last_login < now() - INTERVAL 90 DAY;

-- Frequent row updates via mutation
ALTER TABLE inventory UPDATE quantity = quantity - 1
WHERE product_id = 123;
-- If product exists across 100 parts, rewrites ALL 100 parts
```

**Correct (ReplacingMergeTree):**

```sql
-- Table design for updates
CREATE TABLE users (
    user_id UInt64,
    name String,
    status LowCardinality(String),
    updated_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY user_id;

-- "Update" by inserting new version
INSERT INTO users (user_id, name, status)
VALUES (123, 'John', 'inactive');

-- Query with FINAL to get latest version
SELECT * FROM users FINAL WHERE user_id = 123;

-- Or use aggregation
SELECT user_id, argMax(status, updated_at) as status
FROM users GROUP BY user_id;
```

**MooseStack - ReplacingMergeTree for updates:**

```typescript
import { Key, LowCardinality, UInt64, OlapTable, ClickHouseDefault, ClickHouseEngines } from "@514labs/moose-lib";

interface User {
  userId: Key<UInt64>;
  name: string;
  status: string & LowCardinality;
  updatedAt: Date & ClickHouseDefault<"now()">;
}

// Use ReplacingMergeTree engine for update patterns
export const usersTable = new OlapTable<User>("users", {
  orderByFields: ["userId"],
  engine: ClickHouseEngines.ReplacingMergeTree,
  ver: "updatedAt"  // Version column - keeps row with highest value
});

// "Update" by inserting a new version
await usersTable.insert([{ userId: 123, name: "John", status: "inactive" }]);

// Query with FINAL or aggregation to get latest version
```

```python
from typing import Annotated
from datetime import datetime
from pydantic import BaseModel
from moose_lib import Key, OlapTable, OlapConfig, clickhouse_default
from moose_lib.blocks import ReplacingMergeTreeEngine

class User(BaseModel):
    user_id: Key[int]
    name: str
    status: Annotated[str, "LowCardinality"]
    updated_at: Annotated[datetime, clickhouse_default("now()")]

# Use ReplacingMergeTree engine for update patterns
users_table = OlapTable[User]("users", OlapConfig(
    order_by_fields=["user_id"],
    engine=ReplacingMergeTreeEngine(ver="updated_at")  # Version column - keeps row with highest value
))

# "Update" by inserting a new version
await users_table.insert([User(user_id=123, name="John", status="inactive")])

# Query with FINAL or aggregation to get latest version
```

Reference: [Avoid Mutations](https://clickhouse.com/docs/best-practices/avoid-mutations)
