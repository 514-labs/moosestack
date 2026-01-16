/**
 * Data Models for Query Helpers Test Project
 *
 * Three related tables for an e-commerce scenario:
 * - Orders: Order transactions
 * - Products: Product catalog
 * - Customers: Customer records
 */

import {
  Key,
  OlapTable,
  Stream,
  IngestApi,
  DateTime,
} from "@514labs/moose-lib";

// ============================================
// Orders
// ============================================

export interface Order {
  order_id: Key<string>;
  customer_id: string;
  product_id: string;
  quantity: number;
  amount: number;
  status: string; // "pending" | "completed" | "cancelled"
  created_at: DateTime;
}

export const OrdersTable = new OlapTable<Order>("Orders", {
  orderByFields: ["order_id", "created_at"],
});

export const OrdersStream = new Stream<Order>("orders-stream", {
  destination: OrdersTable,
});

export const OrdersIngest = new IngestApi<Order>("Orders", {
  destination: OrdersStream,
});

// ============================================
// Products
// ============================================

export interface Product {
  product_id: Key<string>;
  name: string;
  category: string;
  price: number;
  stock: number;
  created_at: DateTime;
}

export const ProductsTable = new OlapTable<Product>("Products", {
  orderByFields: ["product_id"],
});

export const ProductsStream = new Stream<Product>("products-stream", {
  destination: ProductsTable,
});

export const ProductsIngest = new IngestApi<Product>("Products", {
  destination: ProductsStream,
});

// ============================================
// Customers
// ============================================

export interface Customer {
  customer_id: Key<string>;
  name: string;
  email: string;
  tier: string; // "bronze" | "silver" | "gold"
  created_at: DateTime;
}

export const CustomersTable = new OlapTable<Customer>("Customers", {
  orderByFields: ["customer_id"],
});

export const CustomersStream = new Stream<Customer>("customers-stream", {
  destination: CustomersTable,
});

export const CustomersIngest = new IngestApi<Customer>("Customers", {
  destination: CustomersStream,
});
