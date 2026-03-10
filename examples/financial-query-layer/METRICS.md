# Metrics Layer Reference

This document describes the `transactionMetrics` query model — the single source of truth for all financial metric calculations in this project.

Defined in [`app/query-models/transaction-metrics.ts`](packages/moosestack-service/app/query-models/transaction-metrics.ts).

## Core Principle

Revenue is defined **once** as `sumIf(totalAmount, status = 'completed')`. Every consumer — the dashboard REST API, MCP tools, and AI SDK — uses this definition. No surface can accidentally include pending, failed, or refunded transactions in revenue calculations.

## Metrics

| Metric | Expression | Description |
|---|---|---|
| `revenue` | `sumIf(totalAmount, status = 'completed')` | Total revenue from completed transactions only |
| `totalTransactions` | `count()` | Total transaction count across all statuses |
| `completedTransactions` | `countIf(status = 'completed')` | Count of successfully settled transactions |
| `failedTransactions` | `countIf(status = 'failed')` | Count of failed transactions |
| `refundedTransactions` | `countIf(status = 'refunded')` | Count of refunded transactions |
| `pendingTransactions` | `countIf(status = 'pending')` | Count of pending transactions |
| `avgTransactionAmount` | `avgIf(totalAmount, status = 'completed')` | Average amount for completed transactions |
| `regionCount` | `uniqExactIf(region, status = 'completed')` | Distinct regions with completed transactions |

## Dimensions

| Dimension | Source | Description |
|---|---|---|
| `region` | `region` column | Geographic region (NA-East, NA-West, EU-West, EU-Central, APAC, LATAM) |
| `status` | `status` column | Transaction status (pending, completed, failed, refunded) |
| `currency` | `currency` column | ISO currency code (USD, EUR, GBP) |
| `paymentMethod` | `paymentMethod` column | Payment instrument (credit_card, debit_card, bank_transfer, paypal, crypto) |
| `day` | `toDate(timestamp)` | Calendar day |
| `hour` | `toStartOfHour(timestamp)` | Hour bucket |
| `month` | `toStartOfMonth(timestamp)` | Month bucket |

## Filters

| Filter | Column | Operators | Description |
|---|---|---|---|
| `region` | `region` | `eq`, `in` | Filter by geographic region |
| `status` | `status` | `eq`, `in` | Filter by transaction status |
| `currency` | `currency` | `eq`, `in` | Filter by currency code |
| `paymentMethod` | `paymentMethod` | `eq`, `in` | Filter by payment method |
| `timestamp` | `timestamp` | `gte`, `lte` | Filter by timestamp range |

## Consumption Patterns

### REST API (`buildQuery`)

The dashboard uses `buildQuery()` to construct type-safe queries against the query model:

```typescript
import { buildQuery, getMooseUtils } from "@514labs/moose-lib";
import { transactionMetrics } from "../query-models/transaction-metrics";

const { client } = await getMooseUtils();
const data = await buildQuery(transactionMetrics)
  .metrics(["revenue"])
  .dimensions(["region"])
  .orderBy(["revenue", "DESC"])
  .execute(client.query);
```

See [`app/apis/revenue.ts`](packages/moosestack-service/app/apis/revenue.ts) for the full implementation.

### MCP Tool (`registerModelTools`)

The query model is automatically registered as the `query_transaction_metrics` MCP tool:

```typescript
import { registerModelTools, type QueryModelBase } from "@514labs/moose-lib";
import { transactionMetrics } from "../query-models/transaction-metrics";

registerModelTools(
  server,
  [transactionMetrics] as unknown as QueryModelBase[],
  mooseUtils.client.query,
);
```

AI assistants call `query_transaction_metrics` with dimensions, metrics, filters, and sort parameters. The tool generates and executes the SQL, enforcing the metric definitions. See [`app/apis/mcp.ts`](packages/moosestack-service/app/apis/mcp.ts).

### AI SDK (`createModelTool`)

For Vercel AI SDK integration, project the query model into a tool:

```typescript
import { createModelTool } from "@514labs/moose-lib";
import { transactionMetrics } from "../query-models/transaction-metrics";

const tool = createModelTool(transactionMetrics, client.query);
```

## Defaults

| Setting | Value |
|---|---|
| Default metrics | `revenue`, `totalTransactions`, `completedTransactions` |
| Default dimensions | (none) |
| Default limit | 100 |
| Max limit | 1000 |
| Sortable fields | `revenue`, `totalTransactions`, `completedTransactions`, `avgTransactionAmount`, `day`, `month` |

## Why This Matters

Without the query layer, AI chat generates free-form SQL against the raw `transactions` table. A common failure mode is computing revenue as `SUM(totalAmount)` without filtering for `status = 'completed'` — inflating the number by including pending, failed, and refunded transactions.

With the query layer, the `revenue` metric **always** applies `sumIf(totalAmount, status = 'completed')`. The AI cannot bypass this definition because it calls `query_transaction_metrics` instead of writing raw SQL.

See the [README](README.md) for a side-by-side comparison of the problem and solution.
