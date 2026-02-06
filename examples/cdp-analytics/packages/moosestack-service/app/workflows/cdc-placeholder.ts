/**
 * Change Data Capture (CDC) Placeholder
 *
 * CDC enables real-time data synchronization from operational databases
 * (PostgreSQL, MySQL, MongoDB) to your analytical data warehouse.
 *
 * This is a placeholder file demonstrating where CDC configuration would go.
 *
 * MOOSE CDC DOCUMENTATION:
 * @see https://docs.fiveonefour.com/moosestack/streaming/connect-cdc
 *
 * CDC Use Cases:
 * - Real-time sync from production PostgreSQL to ClickHouse
 * - Capturing changes from MySQL order tables
 * - Syncing MongoDB document changes
 * - Building real-time data pipelines from transactional systems
 *
 * How CDC Works in Moose:
 * 1. Configure database connection in moose.config.toml
 * 2. Define source tables and target destinations
 * 3. Moose captures INSERT, UPDATE, DELETE operations
 * 4. Changes are streamed to ClickHouse in near real-time
 *
 * Example CDC-as-code configuration:
 *
 * ```typescript
 * import { CdcSource, CdcTable, Stream, mooseRuntimeEnv } from "@514labs/moose-lib";
 *
 * const ordersDb = new CdcSource("orders_cdc", {
 *   kind: "postgresql",
 *   connection: mooseRuntimeEnv.get("ORDERS_DB_URL"),
 * });
 *
 * const orders = new CdcTable<OrderRow>("orders", ordersDb, {
 *   sourceTable: "public.orders",
 *   primaryKey: ["id"],
 *   stream: true,
 *   table: true,
 * });
 *
 * const ordersIngest = new Stream<OrderIngest>("orders_ingest");
 *
 * orders.changes?.addTransform(ordersIngest, (event) => {
 *   const row = event.after ?? event.before;
 *   if (!row) return null;
 *   return {
 *     orderId: row.id,
 *     totalUsd: row.totalCents / 100,
 *     status: row.status,
 *     updatedAt: row.createdAt,
 *     op: event.op,
 *   };
 * });
 * ```
 *
 * For full implementation details, see the Moose CDC documentation.
 */

// This file is intentionally a placeholder.
// Actual CDC implementation requires database infrastructure setup.

export const CDC_DOCS_URL =
  "https://docs.fiveonefour.com/moosestack/streaming/connect-cdc";
