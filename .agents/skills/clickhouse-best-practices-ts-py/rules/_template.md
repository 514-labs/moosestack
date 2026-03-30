---
title: Rule Title Here
impact: CRITICAL | HIGH | MEDIUM | LOW
impactDescription: "Quantified improvement (e.g., 10x faster queries)"
tags: [tag1, tag2]
---

## Rule Title Here

**Impact: CRITICAL** (optional description)

Brief explanation of the rule and why it matters. This should be clear and concise, explaining the performance implications.

**Incorrect (description of what's wrong):**

```sql
-- Bad: description
SELECT * FROM table;
```

**Correct (description of what's right):**

```sql
-- Good: description
SELECT * FROM table;
```

**MooseStack - [Context-specific heading]:**

For schema rules, show how to express this in MooseStack data models. For query rules, show how to apply in APIs or materialized views.

```typescript
import { Key, OlapTable } from "@514labs/moose-lib";

// TypeScript data model example
interface Example {
  id: Key<string>;
  // ... relevant fields with proper types
}

// OlapTable configuration if relevant
export const exampleTable = new OlapTable<Example>("example", {
  orderByFields: ["field1", "field2"],
  // ... other relevant options
});
```

```python
from moose_lib import Key, OlapTable
from pydantic import BaseModel
from typing import Annotated

# Python data model example
class Example(BaseModel):
    id: Key[str]
    # ... relevant fields with proper types

# OlapTable configuration if relevant
example_table = OlapTable[Example]("example", {
    "order_by_fields": ["field1", "field2"],
    # ... other relevant options
})
```

Reference: [Official Docs](https://clickhouse.com/docs/best-practices/...)
