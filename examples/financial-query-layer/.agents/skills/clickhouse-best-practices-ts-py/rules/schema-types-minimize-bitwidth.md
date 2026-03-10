---
title: Minimize Bit-Width for Numeric Types
impact: HIGH
impactDescription: "Smaller types reduce storage and improve cache efficiency"
tags: [schema, data-types, numeric, storage]
---

## Minimize Bit-Width for Numeric Types

**Impact: HIGH**

Select the smallest numeric type that accommodates your data range. Prefer unsigned types when negative values aren't needed.

**Incorrect (oversized types):**

```sql
CREATE TABLE metrics (
    status_code Int64,        -- HTTP codes are 100-599
    age Int64,                -- Human age fits in UInt8
    year Int64,               -- Years fit in UInt16
    item_count Int64          -- Often small numbers
)
```

**MooseStack - Incorrect (default number type is Float64):**

```typescript
// TypeScript - untyped number becomes Float64 (8 bytes)
interface Metrics {
  statusCode: number;    // Float64 - overkill for HTTP codes
  age: number;           // Float64 - overkill for age
  year: number;          // Float64 - overkill for years
  itemCount: number;     // Float64 - overkill for counts
}
```

```python
# Python - int becomes Int64 (8 bytes), float becomes Float64
class Metrics(BaseModel):
    status_code: int     # Int64 - overkill for HTTP codes
    age: int             # Int64 - overkill for age
    year: int            # Int64 - overkill for years
    item_count: int      # Int64 - overkill for counts
```

**Correct (right-sized types):**

```sql
CREATE TABLE metrics (
    status_code UInt16,       -- 0-65,535 (HTTP codes fit easily)
    age UInt8,                -- 0-255 (sufficient for age)
    year UInt16,              -- 0-65,535 (sufficient for years)
    item_count UInt32         -- 0-4 billion (adjust based on actual max)
)
```

**MooseStack - Correct (explicit integer types):**

```typescript
import { Key, UInt8, UInt16, UInt32, OlapTable } from "@514labs/moose-lib";

interface Metrics {
  id: Key<string>;
  statusCode: UInt16;    // 0-65,535 (HTTP codes fit easily) - 2 bytes
  age: UInt8;            // 0-255 (sufficient for age) - 1 byte
  year: UInt16;          // 0-65,535 (sufficient for years) - 2 bytes
  itemCount: UInt32;     // 0-4 billion (adjust based on actual max) - 4 bytes
}

export const metricsTable = new OlapTable<Metrics>("metrics");
```

```python
from typing import Annotated
from pydantic import BaseModel
from moose_lib import Key, OlapTable

class Metrics(BaseModel):
    id: Key[str]
    status_code: Annotated[int, "uint16"]    # 0-65,535 (HTTP codes) - 2 bytes
    age: Annotated[int, "uint8"]             # 0-255 (age) - 1 byte
    year: Annotated[int, "uint16"]           # 0-65,535 (years) - 2 bytes
    item_count: Annotated[int, "uint32"]     # 0-4 billion - 4 bytes

metrics_table = OlapTable[Metrics]("metrics")
```

**MooseStack Type Helpers:**

| Type | TypeScript | Python |
|------|------------|--------|
| UInt8 | `UInt8` | `Annotated[int, "uint8"]` |
| UInt16 | `UInt16` | `Annotated[int, "uint16"]` |
| UInt32 | `UInt32` | `Annotated[int, "uint32"]` |
| UInt64 | `UInt64` | `Annotated[int, "uint64"]` |
| Int8 | `Int8` | `Annotated[int, "int8"]` |
| Int16 | `Int16` | `Annotated[int, "int16"]` |
| Int32 | `Int32` | `Annotated[int, "int32"]` |
| Int64 | `Int64` | `Annotated[int, "int64"]` |

**Numeric Type Reference:**

| Type | Range | Bytes |
|------|-------|-------|
| UInt8 | 0 to 255 | 1 |
| UInt16 | 0 to 65,535 | 2 |
| UInt32 | 0 to 4.3 billion | 4 |
| UInt64 | 0 to 18 quintillion | 8 |
| Int8 | -128 to 127 | 1 |
| Int16 | -32,768 to 32,767 | 2 |
| Int32 | -2.1 billion to 2.1 billion | 4 |
| Int64 | -9 quintillion to 9 quintillion | 8 |

Reference: [Select Data Types](https://clickhouse.com/docs/best-practices/select-data-types)
