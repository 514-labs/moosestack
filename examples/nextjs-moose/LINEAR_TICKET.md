# Improve SQL template literal to support easier WHERE clause building with joins

## Problem

Currently, building dynamic WHERE clauses with multiple conditions using the `sql` template literal requires manual chaining of `Sql` objects, which is verbose and error-prone. When combining multiple conditions with `AND` operators, developers must manually loop through conditions and chain them together.

**Current workaround:**
```typescript
function buildWhereClause(
  startDate?: Date,
  endDate?: Date,
  ...additionalConditions: Sql[]
): Sql {
  const conditions: Sql[] = [];
  
  if (startDate) {
    conditions.push(sql`${Events.columns.event_time} >= toDate(${startDate})`);
  }
  if (endDate) {
    conditions.push(sql`${Events.columns.event_time} <= toDate(${endDate})`);
  }
  conditions.push(...additionalConditions);
  
  if (conditions.length === 0) {
    return sql``;
  }
  
  // Manual chaining required
  let whereClause = sql`WHERE ${conditions[0]}`;
  for (let i = 1; i < conditions.length; i++) {
    whereClause = sql`${whereClause} AND ${conditions[i]}`;
  }
  
  return whereClause;
}
```

This approach:
- Requires manual iteration and chaining
- Is verbose and repetitive
- Doesn't scale well with many conditions
- Makes it difficult to combine conditions with different operators (AND/OR)

## Proposed Solution

Add a helper function or method to the `Sql` class that allows combining multiple `Sql` conditions with a specified operator:

**Option 1: Static helper function**
```typescript
import { sql, sqlAnd, sqlOr } from "@514labs/moose-lib";

const conditions = [
  sql`${Events.columns.event_time} >= toDate(${startDate})`,
  sql`${Events.columns.event_time} <= toDate(${endDate})`,
  sql`${Events.columns.status} = 'active'`
];

const whereClause = sqlAnd(...conditions);
// Results in: WHERE condition1 AND condition2 AND condition3
```

**Option 2: Instance method on Sql class**
```typescript
import { sql } from "@514labs/moose-lib";

const condition1 = sql`${Events.columns.event_time} >= toDate(${startDate})`;
const condition2 = sql`${Events.columns.status} = 'active'`;

const whereClause = sql`WHERE ${condition1.and(condition2)}`;
```

**Option 3: Array support in sql template literal**
```typescript
import { sql } from "@514labs/moose-lib";

const conditions = [
  sql`${Events.columns.event_time} >= toDate(${startDate})`,
  sql`${Events.columns.event_time} <= toDate(${endDate})`,
  sql`${Events.columns.status} = 'active'`
];

// Automatically joins array of Sql objects with AND
const whereClause = sql`WHERE ${conditions}`;
```

## Use Case Example

**Before (current):**
```typescript
export async function getActiveEventsCount(
  startDate?: Date,
  endDate?: Date,
): Promise<number> {
  const whereClause = buildWhereClause(
    startDate,
    endDate,
    sql`${Events.columns.status} = 'active'`,
  );
  const result = await executeQuery<CountResult>(
    sql`SELECT COUNT(*) as count FROM ${Events} ${whereClause}`,
  );
  return result[0]?.count ?? 0;
}
```

**After (with improvement):**
```typescript
export async function getActiveEventsCount(
  startDate?: Date,
  endDate?: Date,
): Promise<number> {
  const conditions = [
    startDate && sql`${Events.columns.event_time} >= toDate(${startDate})`,
    endDate && sql`${Events.columns.event_time} <= toDate(${endDate})`,
    sql`${Events.columns.status} = 'active'`
  ].filter(Boolean) as Sql[];
  
  const whereClause = conditions.length > 0 
    ? sql`WHERE ${sqlAnd(...conditions)}`
    : sql``;
    
  const result = await executeQuery<CountResult>(
    sql`SELECT COUNT(*) as count FROM ${Events} ${whereClause}`,
  );
  return result[0]?.count ?? 0;
}
```

## Additional Considerations

- Support for `OR` operator combinations
- Support for nested conditions with parentheses
- Type safety to ensure only valid SQL fragments are combined
- Performance considerations for large numbers of conditions
- Backward compatibility with existing code

## Priority

Medium - This is a developer experience improvement that would make the library more ergonomic but doesn't block current functionality.

## Labels

- `enhancement`
- `developer-experience`
- `typescript`
- `sql`

