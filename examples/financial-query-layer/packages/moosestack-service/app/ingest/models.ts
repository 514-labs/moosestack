import { OlapTable, Decimal, LowCardinality } from "@514labs/moose-lib";

// ---- User ----

/**
 * Customer account in the platform.
 *
 * Each user belongs to a single geographic region and subscription plan.
 * The `region` field is the primary join key to `transactions` and is
 * used as a top-level dimension in revenue reporting.
 */
export interface User {
  /** Unique identifier for the user (UUID). */
  userId: string;
  /** Account creation timestamp. */
  createdAt: Date;
  /** Full display name. */
  name: string;
  /** Email address (unique per user). */
  email: string;
  /** Geographic region: NA-East, NA-West, EU-West, EU-Central, APAC, LATAM. */
  region: string & LowCardinality;
  /** Subscription tier. */
  plan: "free" | "pro" | "enterprise";
}

/**
 * Users table — ordered by (region, userId) for efficient regional lookups
 * and per-user queries within a region.
 */
export const UserTable = new OlapTable<User>("users", {
  orderByFields: ["region", "userId"],
});

// ---- Product ----

/**
 * Product in the catalog.
 *
 * Products are grouped by category and have a fixed list price (`unitPrice`).
 * The actual price at time of purchase is stored on the line item, not here.
 */
export interface Product {
  /** Unique identifier for the product (UUID). */
  productId: string;
  /** Human-readable product name. */
  name: string;
  /** Product category: Electronics, Software, Services, Hardware, Consulting. */
  category: string & LowCardinality;
  /** List price in USD. */
  unitPrice: Decimal<10, 2>;
  /** When the product was added to the catalog. */
  createdAt: Date;
}

/**
 * Products table — ordered by (category, productId) for efficient
 * category-level queries and individual product lookups.
 */
export const ProductTable = new OlapTable<Product>("products", {
  orderByFields: ["category", "productId"],
});

// ---- Transaction ----

/**
 * Financial transaction header.
 *
 * Represents a single purchase event. The `status` field is critical for
 * business metrics — **revenue is defined as the sum of `totalAmount`
 * where `status = 'completed'`**. Other statuses (pending, failed, refunded)
 * are excluded from revenue calculations.
 *
 * `totalAmount` is denormalized (sum of line item amounts) so revenue
 * queries don't require a JOIN to `transaction_line_items`.
 */
export interface Transaction {
  /** Unique identifier for the transaction (UUID). */
  transactionId: string;
  /** When the transaction occurred. */
  timestamp: Date;
  /** Foreign key to `users.userId`. */
  userId: string;
  /**
   * Transaction lifecycle status.
   * - `pending`   — awaiting processing
   * - `completed` — successfully settled (counts toward revenue)
   * - `failed`    — payment declined or error
   * - `refunded`  — reversed after completion
   */
  status: "pending" | "completed" | "failed" | "refunded";
  /** Geographic region (denormalized from user for efficient filtering). */
  region: string & LowCardinality;
  /** ISO currency code. */
  currency: string & LowCardinality;
  /** Payment instrument used. */
  paymentMethod: string & LowCardinality;
  /** Sum of all line item amounts for this transaction (in `currency`). */
  totalAmount: Decimal<10, 2>;
}

/**
 * Transactions table — ordered by (userId, timestamp) for efficient
 * per-user lookups over time. Revenue queries filter on `status`.
 */
export const TransactionTable = new OlapTable<Transaction>("transactions", {
  orderByFields: ["userId", "timestamp"],
});

// ---- Transaction Line Item ----

/**
 * Individual line item within a transaction.
 *
 * Each transaction has 1–8 line items. The `amount` field is
 * `quantity × unitPrice` at time of purchase (unitPrice may differ
 * from the product's current list price).
 */
export interface TransactionLineItem {
  /** Unique identifier for the line item (UUID). */
  lineItemId: string;
  /** Foreign key to `transactions.transactionId`. */
  transactionId: string;
  /** Inherited from parent transaction. */
  timestamp: Date;
  /** Foreign key to `products.productId`. */
  productId: string;
  /** Units purchased. */
  quantity: number;
  /** Price per unit at time of purchase (may differ from catalog price). */
  unitPrice: Decimal<10, 2>;
  /** Total for this line: quantity × unitPrice. */
  amount: Decimal<10, 2>;
}

/**
 * Line items table — ordered by (transactionId, timestamp) for efficient
 * retrieval of all items belonging to a single transaction.
 */
export const TransactionLineItemTable = new OlapTable<TransactionLineItem>(
  "transaction_line_items",
  {
    orderByFields: ["transactionId", "timestamp"],
  },
);
