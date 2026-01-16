/**
 * Scheduled Sync Workflow
 *
 * Demonstrates scheduled/recurring data ingestion using Moose Workflows.
 * Simulates syncing product catalog from an external API on a schedule.
 *
 * Use case: Hourly/daily sync from CRM, ERP, or third-party APIs
 *
 * @see https://docs.fiveonefour.com/moosestack/workflows
 */

import { Task, Workflow, getTable } from "@514labs/moose-lib";
import { Product } from "../ingest/models";

// Simulated external API response
interface ExternalProduct {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategory: string;
  brand: string;
  price: number;
  originalPrice: number;
  costPrice: number;
  inventory: number;
  active: boolean;
  rating: number;
  reviews: number;
  lastUpdated: string;
}

// Result type for the sync task
interface SyncResult {
  synced: number;
  created: number;
  updated: number;
  errors: string[];
  timestamp: string;
}

/**
 * Simulate fetching products from an external API
 * In real world, this would call an actual API endpoint
 */
async function fetchFromExternalAPI(): Promise<ExternalProduct[]> {
  console.log("[ScheduledSync] Fetching from external API...");

  // Simulate API latency
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Generate some "new" products that might have been added/updated
  const timestamp = Date.now();
  const products: ExternalProduct[] = [
    {
      id: `SYNC-${timestamp}-001`,
      name: "Wireless Bluetooth Headphones",
      description: "Premium wireless headphones with noise cancellation",
      category: "electronics",
      subcategory: "audio",
      brand: "TechPro",
      price: 149.99,
      originalPrice: 199.99,
      costPrice: 75.0,
      inventory: 150,
      active: true,
      rating: 4.5,
      reviews: 230,
      lastUpdated: new Date().toISOString(),
    },
    {
      id: `SYNC-${timestamp}-002`,
      name: "Organic Cotton T-Shirt",
      description: "Sustainable organic cotton t-shirt",
      category: "clothing",
      subcategory: "tops",
      brand: "StyleMax",
      price: 34.99,
      originalPrice: 34.99,
      costPrice: 12.0,
      inventory: 500,
      active: true,
      rating: 4.2,
      reviews: 89,
      lastUpdated: new Date().toISOString(),
    },
    {
      id: `SYNC-${timestamp}-003`,
      name: "Smart Home Hub",
      description: "Central hub for all smart home devices",
      category: "electronics",
      subcategory: "smart_home",
      brand: "GadgetWorld",
      price: 89.99,
      originalPrice: 119.99,
      costPrice: 45.0,
      inventory: 75,
      active: true,
      rating: 4.7,
      reviews: 156,
      lastUpdated: new Date().toISOString(),
    },
  ];

  console.log(`[ScheduledSync] Fetched ${products.length} products from API`);
  return products;
}

/**
 * Transform external API format to our Product model
 */
function transformProduct(external: ExternalProduct): Product {
  return {
    productSku: external.id,
    productName: external.name,
    description: external.description,
    category: external.category,
    subcategory: external.subcategory,
    brand: external.brand,
    price: external.price,
    originalPrice: external.originalPrice,
    costPrice: external.costPrice,
    stockQuantity: external.inventory,
    isActive: external.active,
    createdAt: new Date(),
    updatedAt: new Date(external.lastUpdated),
    avgRating: external.rating,
    reviewCount: external.reviews,
  };
}

/**
 * Scheduled Sync Task
 * Fetches products from external API and syncs to ClickHouse
 */
export const scheduledSyncTask = new Task<null, SyncResult>(
  "scheduled-sync-task",
  {
    run: async () => {
      const errors: string[] = [];
      const timestamp = new Date().toISOString();

      console.log(`[ScheduledSync] Starting sync at ${timestamp}`);

      try {
        // Fetch from external API
        const externalProducts = await fetchFromExternalAPI();

        // Transform to our model
        const products = externalProducts.map(transformProduct);

        // Insert to ClickHouse
        const productTable = getTable("Product");
        if (!productTable) {
          throw new Error("Product table not found");
        }

        await productTable.insert(products as any);
        console.log(`[ScheduledSync] Inserted ${products.length} products`);

        return {
          synced: products.length,
          created: products.length, // In real world, we'd track creates vs updates
          updated: 0,
          errors: [],
          timestamp,
        };
      } catch (err) {
        const msg = `Sync failed: ${err}`;
        console.error(`[ScheduledSync] ${msg}`);
        errors.push(msg);

        return {
          synced: 0,
          created: 0,
          updated: 0,
          errors,
          timestamp,
        };
      }
    },
  },
);

/**
 * Scheduled Sync Workflow
 *
 * Runs every 5 minutes (for demo purposes)
 * In production, you might use "0 * * * *" for hourly or "0 0 * * *" for daily
 */
export const scheduledSyncWorkflow = new Workflow("scheduled-sync", {
  startingTask: scheduledSyncTask,
  schedule: "*/5 * * * *", // Every 5 minutes
});
