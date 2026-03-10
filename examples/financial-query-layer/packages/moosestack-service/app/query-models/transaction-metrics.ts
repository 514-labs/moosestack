/**
 * Transaction Metrics — semantic query model for financial metrics.
 *
 * This is the single source of truth for how "revenue" is calculated:
 * `sumIf(totalAmount, status = 'completed')`. Every consumer — the
 * dashboard REST API, MCP tools, and AI SDK — uses this definition,
 * guaranteeing consistent numbers across all interfaces.
 *
 * All column references use `TransactionTable.columns.*` so that
 * renaming a field in the Transaction interface produces a compile
 * error here instead of silently generating wrong SQL at runtime.
 *
 * ## Consumption
 *
 * - **MCP tool**: Automatically registered as `query_transaction_metrics`
 *   via `registerModelTools()` in `mcp.ts`.
 * - **REST API**: The `/revenue/by-region` endpoint uses `buildQuery()`
 *   with this model in `revenue.ts`.
 * - **AI SDK**: Can be projected via `createModelTool()` for Vercel AI SDK.
 *
 * @see https://docs.fiveonefour.com/moosestack/apis/semantic-layer
 */
import { defineQueryModel, sql, count } from "@514labs/moose-lib";
import { TransactionTable } from "../ingest/models";

export const transactionMetrics = defineQueryModel({
  name: "query_transaction_metrics",
  description:
    "Financial transaction metrics. " +
    "Revenue is defined as sum of totalAmount for COMPLETED transactions only " +
    "(excludes pending, failed, and refunded). " +
    "Dimensions: region, currency, paymentMethod, status, and time granularities (day, hour, month). " +
    "Filters: region, status, currency, paymentMethod, timestamp range.",

  table: TransactionTable,

  dimensions: {
    region: {
      column: "region",
      description:
        "Geographic region (NA-East, NA-West, EU-West, EU-Central, APAC, LATAM)",
    },
    currency: {
      column: "currency",
      description: "ISO currency code (USD, EUR, GBP)",
    },
    paymentMethod: {
      column: "paymentMethod",
      description:
        "Payment instrument (credit_card, debit_card, bank_transfer, paypal, crypto)",
    },
    day: {
      expression: sql`toDate(${TransactionTable.columns.timestamp})`,
      as: "day",
      description: "Calendar day",
    },
    hour: {
      expression: sql`toStartOfHour(${TransactionTable.columns.timestamp})`,
      as: "hour",
      description: "Hour bucket",
    },
    month: {
      expression: sql`toStartOfMonth(${TransactionTable.columns.timestamp})`,
      as: "month",
      description: "Month bucket",
    },
  },

  metrics: {
    revenue: {
      agg: sql`sumIf(${TransactionTable.columns.totalAmount}, ${TransactionTable.columns.status} = 'completed')`,
      as: "revenue",
      description:
        "Total revenue: sum of totalAmount for completed transactions only. " +
        "Excludes pending, failed, and refunded.",
    },
    totalTransactions: {
      agg: count(),
      as: "totalTransactions",
      description: "Total transaction count across all statuses",
    },
    completedTransactions: {
      agg: sql`countIf(${TransactionTable.columns.status} = 'completed')`,
      as: "completedTransactions",
      description: "Count of completed (settled) transactions",
    },
    failedTransactions: {
      agg: sql`countIf(${TransactionTable.columns.status} = 'failed')`,
      as: "failedTransactions",
      description: "Count of failed transactions",
    },
    refundedTransactions: {
      agg: sql`countIf(${TransactionTable.columns.status} = 'refunded')`,
      as: "refundedTransactions",
      description: "Count of refunded transactions",
    },
    pendingTransactions: {
      agg: sql`countIf(${TransactionTable.columns.status} = 'pending')`,
      as: "pendingTransactions",
      description: "Count of pending transactions",
    },
    refundedAmount: {
      agg: sql`sumIf(${TransactionTable.columns.totalAmount}, ${TransactionTable.columns.status} = 'refunded')`,
      as: "refundedAmount",
      description: "Total dollar amount of refunded transactions",
    },
    pendingAmount: {
      agg: sql`sumIf(${TransactionTable.columns.totalAmount}, ${TransactionTable.columns.status} = 'pending')`,
      as: "pendingAmount",
      description: "Total dollar amount of pending transactions",
    },
    avgTransactionAmount: {
      agg: sql`avgIf(${TransactionTable.columns.totalAmount}, ${TransactionTable.columns.status} = 'completed')`,
      as: "avgTransactionAmount",
      description: "Average transaction amount (completed only)",
    },
    medianTransactionAmount: {
      agg: sql`medianIf(${TransactionTable.columns.totalAmount}, ${TransactionTable.columns.status} = 'completed')`,
      as: "medianTransactionAmount",
      description: "Median transaction amount (completed only)",
    },
    regionCount: {
      agg: sql`uniqExactIf(${TransactionTable.columns.region}, ${TransactionTable.columns.status} = 'completed')`,
      as: "regionCount",
      description:
        "Count of distinct regions with at least one completed transaction",
    },
  },

  filters: {
    region: {
      column: "region",
      operators: ["eq", "in"] as const,
      description: "Filter by geographic region",
    },
    currency: {
      column: "currency",
      operators: ["eq", "in"] as const,
      description: "Filter by currency code (USD, EUR, GBP)",
    },
    paymentMethod: {
      column: "paymentMethod",
      operators: ["eq", "in"] as const,
      description: "Filter by payment method",
    },
    timestamp: {
      column: "timestamp",
      operators: ["gte", "lte"] as const,
      description: "Filter by timestamp range",
    },
  },

  sortable: [
    "revenue",
    "totalTransactions",
    "completedTransactions",
    "avgTransactionAmount",
    "day",
    "month",
  ] as const,

  defaults: {
    metrics: ["revenue", "totalTransactions", "completedTransactions"],
    dimensions: [],
    orderBy: [],
    limit: 100,
    maxLimit: 1000,
  },
});
