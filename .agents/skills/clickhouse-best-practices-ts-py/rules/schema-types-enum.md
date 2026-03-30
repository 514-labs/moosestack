---
title: Use Enum for Finite Value Sets
impact: MEDIUM
impactDescription: "Insert-time validation and natural ordering; 1-2 bytes storage"
tags: [schema, data-types, Enum, validation]
---

## Use Enum for Finite Value Sets

**Impact: MEDIUM**

Enum types provide validation at insert time and enable queries that exploit natural ordering. Use Enum8 (up to 256 values) or Enum16 (up to 65,536 values).

**Incorrect (String without validation):**

```sql
CREATE TABLE orders (
    status String    -- No validation, typos like "shiped" allowed
)

-- Ordering requires CASE statements
SELECT * FROM orders ORDER BY
    CASE status
        WHEN 'pending' THEN 1
        WHEN 'processing' THEN 2
        WHEN 'shipped' THEN 3
    END;
```

**MooseStack - Incorrect (plain string):**

```typescript
// TypeScript - No validation, any string allowed
interface Order {
  status: string;  // No validation
}
```

```python
# Python - No validation, any string allowed
class Order(BaseModel):
    status: str  # No validation
```

**Correct (Enum with validation and ordering):**

```sql
CREATE TABLE orders (
    status Enum8('pending' = 1, 'processing' = 2, 'shipped' = 3, 'delivered' = 4)
)

-- Insert validation: invalid values rejected
INSERT INTO orders VALUES ('shiped');  -- ERROR: Unknown element 'shiped'

-- Natural ordering works automatically
SELECT * FROM orders ORDER BY status;  -- Orders by enum value (1, 2, 3, 4)

-- Comparisons use natural order
SELECT * FROM orders WHERE status > 'processing';  -- shipped and delivered
```

**MooseStack - Correct (TypeScript enum):**

```typescript
import { Key, OlapTable } from "@514labs/moose-lib";

// Define enum with explicit values for ordering
enum OrderStatus {
  PENDING = "pending",
  PROCESSING = "processing",
  SHIPPED = "shipped",
  DELIVERED = "delivered"
}

interface Order {
  id: Key<string>;
  status: OrderStatus;  // Maps to Enum8 in ClickHouse
}

export const ordersTable = new OlapTable<Order>("orders");
```

**MooseStack - Correct (Python enum):**

```python
from enum import Enum
from pydantic import BaseModel
from moose_lib import Key, OlapTable

# Define enum with explicit values for ordering
class OrderStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    SHIPPED = "shipped"
    DELIVERED = "delivered"

class Order(BaseModel):
    id: Key[str]
    status: OrderStatus  # Maps to Enum8 in ClickHouse

orders_table = OlapTable[Order]("orders")
```

**MooseStack Enum Guidelines:**

| Scenario | TypeScript | Python |
|----------|------------|--------|
| Fixed set of values | `enum Status { ... }` | `class Status(str, Enum)` |
| Numeric enum | `enum Priority { LOW = 1, HIGH = 2 }` | `class Priority(IntEnum)` |
| String literal union | `"pending" \| "shipped"` | `Literal["pending", "shipped"]` |

**Enum Guidelines:**

| Scenario | Use |
|----------|-----|
| Fixed set of values known at schema time | Enum8/Enum16 |
| Values may change frequently | LowCardinality(String) |
| Need insert-time validation | Enum |
| Need natural ordering in queries | Enum |
| < 256 distinct values | Enum8 (1 byte) |
| 256-65,536 distinct values | Enum16 (2 bytes) |

Reference: [Select Data Types](https://clickhouse.com/docs/best-practices/select-data-types)
