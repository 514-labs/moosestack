---
title: Use ANY JOIN When Only One Match Needed
impact: HIGH
impactDescription: "Returns first match only; less memory and faster execution"
tags: [query, JOIN, ANY, performance]
---

## Use ANY JOIN When Only One Match Needed

**Impact: HIGH**

Use `ANY` JOINs when you only need a single match rather than all matches. They consume less memory and execute faster.

**Incorrect (returns all matches):**

```sql
-- Returns all matching rows, uses more memory
SELECT o.order_id, c.name
FROM orders o
LEFT JOIN customers c ON c.id = o.customer_id;
```

**Correct (returns first match only):**

```sql
-- Returns only first match per row, faster and less memory
SELECT o.order_id, c.name
FROM orders o
LEFT ANY JOIN customers c ON c.id = o.customer_id;
```

**ANY JOIN types:**

| Type | Behavior |
|------|----------|
| `LEFT ANY JOIN` | At most one match from right table |
| `INNER ANY JOIN` | At most one match, only matching rows |
| `RIGHT ANY JOIN` | At most one match from left table |

**MooseStack - Apply in SQL queries:**

```typescript
import { Api } from "@514labs/moose-lib";

const ordersApi = new Api<QueryParams, Result[]>(
  "orders",
  async (params, { client }) => {
    // Use ANY JOIN when you only need one match per row
    const query = `
      SELECT o.order_id, c.name
      FROM orders o
      LEFT ANY JOIN customers c ON c.id = o.customer_id
      WHERE o.created_at > {startDate: Date}
    `;
    return client.query(query, { startDate: params.startDate });
  }
);
```

These SQL optimization patterns apply to any ClickHouse query in your MooseStack APIs and materialized views.

Reference: [Minimize and Optimize JOINs](https://clickhouse.com/docs/best-practices/minimize-optimize-joins)
