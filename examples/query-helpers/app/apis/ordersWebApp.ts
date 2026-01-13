/**
 * Orders WebApp - Demonstrates Query Helpers v2 Pattern
 *
 * This file shows how to use the 3-layer architecture:
 * - Layer 1: Typia validation for param types
 * - Layer 2: ParamMap for column mapping
 * - Layer 3: SQL builders for query generation
 *
 * Fan-out pattern uses separate handler functions, each respecting the layers.
 */

import express from "express";
import { tags } from "typia";
import { WebApp, getMooseUtils, MooseClient, Sql } from "@514labs/moose-lib";
import { Order, OrdersTable } from "../ingest/models";
import {
  // Layer 1: Validation
  createParamValidatorSafe,
  PaginationParams,
  DateRangeParams,
  // Layer 2: Mapping
  createParamMap,
  ParamMapConfig,
  QueryIntent,
  // Layer 3: SQL Generation
  toQuerySql,
  toWhereSql,
  toSelectSql,
} from "../../src/query-helpers_v2";

// ============================================
// Layer 1: Param Types with Typia Constraints
// ============================================

/**
 * Filter params for Orders - what users can filter by.
 */
interface OrderFilters {
  orderId?: string;
  customerId?: string;
  productId?: string;
  status?: "pending" | "completed" | "cancelled";
  minAmount?: number & tags.Minimum<0>;
  maxAmount?: number & tags.Minimum<0>;
  minQuantity?: number & tags.Type<"int32"> & tags.Minimum<1>;
}

/**
 * Complete query params for the Orders endpoint.
 */
interface OrderQueryParams {
  filters?: OrderFilters;
  pagination?: PaginationParams;
  dateRange?: DateRangeParams;
  reportType?: "list" | "summary" | "by-status";
}

// Create Typia validator at compile time
const validateParams = createParamValidatorSafe<OrderQueryParams>();

// ============================================
// Layer 2: Param-to-Column Mapping
// ============================================

const orderFilterMapping: ParamMapConfig<OrderFilters, Order>["filters"] = {
  orderId: { column: "order_id" },
  customerId: { column: "customer_id" },
  productId: { column: "product_id" },
  status: { column: "status" },
  minAmount: { column: "amount", operator: "gte" },
  maxAmount: { column: "amount", operator: "lte" },
  minQuantity: { column: "quantity", operator: "gte" },
};

const orderParamMap = createParamMap<OrderFilters, Order>(OrdersTable, {
  filters: orderFilterMapping,
  defaultSelect: [
    "order_id",
    "customer_id",
    "product_id",
    "quantity",
    "amount",
    "status",
    "created_at",
  ],
  defaultOrderBy: [{ column: "created_at", direction: "DESC" }],
});

// ============================================
// Layer 3: Query Functions (Fan-Out Handlers)
// ============================================

/**
 * Summary report query function.
 * Returns aggregate statistics for orders matching filters.
 */
async function querySummaryReport(
  client: MooseClient,
  sql: typeof import("@514labs/moose-lib").sql,
  params: OrderQueryParams,
): Promise<{ reportType: string; data: unknown }> {
  // Layer 2: Map params to query intent (for WHERE clause)
  const intent = orderParamMap.toIntent({
    filters: params.filters,
  });

  // Layer 3: Build aggregation query with WHERE from intent
  const whereClause =
    intent.where.length > 0 ?
      sql`WHERE ${toWhereSql(OrdersTable, intent.where)}`
    : sql``;

  const query = sql`
    SELECT 
      COUNT(*) as total_orders,
      SUM(amount) as total_revenue,
      AVG(amount) as avg_order_value,
      MIN(amount) as min_order,
      MAX(amount) as max_order
    FROM ${OrdersTable}
    ${whereClause}
  `;

  const result = await client.query.execute(query);
  return {
    reportType: "summary",
    data: await result.json(),
  };
}

/**
 * By-status report query function.
 * Returns order counts grouped by status, with filters applied.
 */
async function queryByStatusReport(
  client: MooseClient,
  sql: typeof import("@514labs/moose-lib").sql,
  params: OrderQueryParams,
): Promise<{ reportType: string; data: unknown }> {
  // Layer 2: Map params to query intent (for WHERE clause)
  const intent = orderParamMap.toIntent({
    filters: params.filters,
  });

  // Layer 3: Build grouped aggregation query with WHERE from intent
  const whereClause =
    intent.where.length > 0 ?
      sql`WHERE ${toWhereSql(OrdersTable, intent.where)}`
    : sql``;

  const query = sql`
    SELECT 
      status,
      COUNT(*) as order_count,
      SUM(amount) as total_amount,
      AVG(amount) as avg_amount
    FROM ${OrdersTable}
    ${whereClause}
    GROUP BY status
    ORDER BY order_count DESC
  `;

  const result = await client.query.execute(query);
  return {
    reportType: "by-status",
    data: await result.json(),
  };
}

/**
 * List orders query function.
 * Returns paginated order list with filters applied.
 */
async function queryOrdersList(
  client: MooseClient,
  _sql: typeof import("@514labs/moose-lib").sql,
  params: OrderQueryParams,
): Promise<{ reportType: string; pagination: object; data: unknown }> {
  // Layer 2: Map params to query intent
  const intent = orderParamMap.toIntent({
    filters: params.filters,
    pagination: params.pagination,
  });

  // Layer 3: Generate SQL from intent
  const query = toQuerySql(OrdersTable, intent);

  const result = await client.query.execute(query);
  return {
    reportType: "list",
    pagination: intent.pagination,
    data: await result.json(),
  };
}

// ============================================
// Fan-Out Dispatcher
// ============================================

type ReportType = NonNullable<OrderQueryParams["reportType"]>;

type QueryHandler = (
  client: MooseClient,
  sql: typeof import("@514labs/moose-lib").sql,
  params: OrderQueryParams,
) => Promise<{ reportType: string; data?: unknown; pagination?: object }>;

const queryHandlers: Record<ReportType, QueryHandler> = {
  list: queryOrdersList,
  summary: querySummaryReport,
  "by-status": queryByStatusReport,
};

// ============================================
// Express App
// ============================================

const app = express();
app.use(express.json());

/**
 * POST /orders
 *
 * Main endpoint demonstrating all 3 layers:
 * 1. Validates params with Typia
 * 2. Dispatches to appropriate handler based on reportType
 * 3. Each handler respects the layer architecture
 */
app.post("/", async (req, res) => {
  try {
    // Merge query string + body params
    const params = { ...req.query, ...req.body };

    // ============================================
    // Layer 1: Validate with Typia
    // ============================================
    const validated = validateParams(params);

    if (!validated.ok) {
      return res.status(400).json({
        error: "Invalid parameters",
        details: validated.errors,
      });
    }

    // Get Moose utilities
    const { client, sql } = await getMooseUtils();

    // ============================================
    // Fan-Out: Dispatch to appropriate handler
    // ============================================
    const reportType = validated.data.reportType ?? "list";
    const handler = queryHandlers[reportType];

    const result = await handler(client, sql, validated.data);
    return res.json(result);
  } catch (error) {
    console.error("Error processing request:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

/**
 * GET /orders/health
 * Health check endpoint
 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Export as Moose WebApp
export default new WebApp("orders-api", app, { mountPath: "/orders" });
