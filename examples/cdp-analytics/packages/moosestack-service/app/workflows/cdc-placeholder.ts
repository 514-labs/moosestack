/**
 * Change Data Capture (CDC) Placeholder
 *
 * CDC enables real-time data synchronization from operational databases
 * (PostgreSQL, MySQL, MongoDB) to your analytical data warehouse.
 *
 * This is a placeholder file demonstrating where CDC configuration would go.
 *
 * MOOSE CDC DOCUMENTATION:
 * @see https://docs.fiveonefour.com/moosestack/capture-data-changes
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
 * Example Configuration (moose.config.toml):
 *
 * ```toml
 * [[cdc_sources]]
 * name = "postgres_orders"
 * type = "postgresql"
 * connection_string = "postgres://user:pass@host:5432/db"
 * tables = ["orders", "order_items", "customers"]
 *
 * [[cdc_destinations]]
 * source = "postgres_orders"
 * table = "orders"
 * destination = "Transaction"
 * ```
 *
 * Example Transform (app/cdc/orders.ts):
 *
 * ```typescript
 * import { CDCTransform } from "@514labs/moose-lib";
 *
 * export const ordersTransform = new CDCTransform<PostgresOrder, Transaction>(
 *   "orders",
 *   {
 *     transform: (change) => ({
 *       transactionId: change.after.id,
 *       customerId: change.after.customer_id,
 *       totalAmount: change.after.total / 100, // cents to dollars
 *       status: mapStatus(change.after.status),
 *       timestamp: change.after.created_at,
 *       // ... map other fields
 *     }),
 *   }
 * );
 * ```
 *
 * For full implementation details, see the Moose CDC documentation.
 */

// This file is intentionally a placeholder.
// Actual CDC implementation requires database infrastructure setup.

export const CDC_DOCS_URL =
  "https://docs.fiveonefour.com/moosestack/capture-data-changes";
