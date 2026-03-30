---
title: Avoid ALTER TABLE DELETE
impact: CRITICAL
impactDescription: "Use lightweight DELETE, CollapsingMergeTree, or DROP PARTITION instead"
tags: [insert, mutation, DELETE, CollapsingMergeTree]
---

## Avoid ALTER TABLE DELETE

**Impact: CRITICAL**

`ALTER TABLE DELETE` is a mutation that rewrites entire data parts. Use alternatives like lightweight DELETE, CollapsingMergeTree, or DROP PARTITION.

**Incorrect (mutation delete):**

```sql
-- Mutation delete for cleanup
ALTER TABLE orders DELETE WHERE status = 'cancelled';

-- Time-based cleanup via mutation (very expensive)
ALTER TABLE sessions DELETE WHERE created_at < now() - INTERVAL 7 DAY;
```

**Correct - CollapsingMergeTree:**

```sql
CREATE TABLE orders (
    order_id UInt64,
    customer_id UInt64,
    total Decimal(10,2),
    sign Int8  -- 1 = active, -1 = deleted
)
ENGINE = CollapsingMergeTree(sign)
ORDER BY order_id;

-- Insert order
INSERT INTO orders VALUES (123, 456, 99.99, 1);

-- "Delete" by inserting with sign = -1
INSERT INTO orders VALUES (123, 456, 99.99, -1);

-- Query collapses +1 and -1 pairs
SELECT order_id, sum(total * sign) as total
FROM orders GROUP BY order_id HAVING sum(sign) > 0;
```

**Correct - Lightweight Deletes (23.3+):**

```sql
-- Marks rows, doesn't rewrite immediately
DELETE FROM orders WHERE status = 'cancelled';
-- Physical deletion happens during normal merges
```

**Correct - DROP PARTITION for Bulk Deletion:**

```sql
-- Instant deletion of old data
ALTER TABLE events DROP PARTITION '202301';

-- Much faster than:
ALTER TABLE events DELETE WHERE toYYYYMM(timestamp) = 202301;
```

**Delete strategy comparison:**

| Method | Speed | When to Use |
|--------|-------|-------------|
| ALTER DELETE | Slow | Rare corrections only |
| CollapsingMergeTree | Fast | Frequent soft deletes |
| Lightweight DELETE | Medium | Occasional deletes |
| DROP PARTITION | Instant | Bulk deletion by partition |

**MooseStack - CollapsingMergeTree for soft deletes:**

```typescript
import { Key, UInt64, Int8, Decimal, OlapTable, ClickHouseEngines } from "@514labs/moose-lib";

interface Order {
  orderId: Key<UInt64>;
  customerId: UInt64;
  total: Decimal<10, 2>;
  sign: Int8;  // 1 = active, -1 = deleted
}

// Use CollapsingMergeTree engine for soft delete patterns
export const ordersTable = new OlapTable<Order>("orders", {
  orderByFields: ["orderId"],
  engine: ClickHouseEngines.CollapsingMergeTree,
  sign: "sign"  // Required sign column
});

// Insert order (sign = 1)
await ordersTable.insert([{ orderId: 123, customerId: 456, total: "99.99", sign: 1 }]);

// "Delete" order by inserting with sign = -1
await ordersTable.insert([{ orderId: 123, customerId: 456, total: "99.99", sign: -1 }]);
```

```python
from typing import Annotated
from decimal import Decimal
from pydantic import BaseModel
from moose_lib import Key, OlapTable, OlapConfig, clickhouse_decimal
from moose_lib.blocks import CollapsingMergeTreeEngine

class Order(BaseModel):
    order_id: Key[int]
    customer_id: Annotated[int, "uint64"]
    total: clickhouse_decimal(10, 2)
    sign: Annotated[int, "int8"]  # 1 = active, -1 = deleted

# Use CollapsingMergeTree engine for soft delete patterns
orders_table = OlapTable[Order]("orders", OlapConfig(
    order_by_fields=["order_id"],
    engine=CollapsingMergeTreeEngine(sign="sign")  # Required sign column
))

# Insert order (sign = 1)
await orders_table.insert([Order(order_id=123, customer_id=456, total=Decimal("99.99"), sign=1)])

# "Delete" order by inserting with sign = -1
await orders_table.insert([Order(order_id=123, customer_id=456, total=Decimal("99.99"), sign=-1)])
```

**MooseStack - TTL for automatic data lifecycle:**

```typescript
export const eventsTable = new OlapTable<Event>("events", {
  orderByFields: ["eventType", "timestamp"],
  partitionBy: "toStartOfMonth(timestamp)",
  ttl: "timestamp + INTERVAL 90 DAY DELETE"  // Auto-delete old data
});
```

Reference: [Avoid Mutations](https://clickhouse.com/docs/best-practices/avoid-mutations)
