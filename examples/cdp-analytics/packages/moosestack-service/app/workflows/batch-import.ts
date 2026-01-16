/**
 * Batch Import Workflow
 *
 * Demonstrates batch data ingestion using Moose Workflows.
 * Reads historical transaction data from CSV and inserts directly to ClickHouse.
 *
 * Use case: Historical data migration, nightly CRM sync, CSV uploads
 *
 * @see https://docs.fiveonefour.com/moosestack/workflows
 */

import { Task, Workflow, getTable } from "@514labs/moose-lib";
import * as fs from "fs";
import { Transaction } from "../ingest/models";

// Input type for the workflow
interface BatchImportInput {
  csvPath: string;
}

// Result type for the workflow
interface BatchImportResult {
  totalRows: number;
  inserted: number;
  failed: number;
  errors: string[];
}

/**
 * Parse CSV file into transaction records
 */
function parseCSV(filePath: string): Transaction[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",");

  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = values[i] || "";
    });

    return {
      transactionId: row.transactionId,
      customerId: row.customerId,
      sessionId: row.sessionId,
      timestamp: new Date(row.timestamp),
      orderState: row.orderState,
      status: row.status,
      source: row.source,
      subtotal: parseFloat(row.subtotal),
      discountAmount: parseFloat(row.discountAmount),
      taxAmount: parseFloat(row.taxAmount),
      shippingAmount: parseFloat(row.shippingAmount),
      tipAmount: parseFloat(row.tipAmount),
      totalAmount: parseFloat(row.totalAmount),
      currency: row.currency,
      paymentMethod: row.paymentMethod,
      couponCode: row.couponCode,
      itemCount: parseInt(row.itemCount, 10),
      shippingCountry: row.shippingCountry,
      shippingCity: row.shippingCity,
      isFirstPurchase: row.isFirstPurchase === "true",
      attributionChannel: row.attributionChannel,
    };
  });
}

/**
 * Batch Import Task
 * Reads CSV file and inserts records directly to ClickHouse
 */
export const batchImportTask = new Task<BatchImportInput, BatchImportResult>(
  "batch-import-task",
  {
    run: async (ctx) => {
      const { csvPath } = ctx.input;
      const errors: string[] = [];

      console.log(`[BatchImport] Starting import from: ${csvPath}`);

      // Parse CSV
      let rows: Transaction[];
      try {
        rows = parseCSV(csvPath);
        console.log(`[BatchImport] Parsed ${rows.length} rows`);
      } catch (err) {
        const msg = `Failed to parse CSV: ${err}`;
        console.error(`[BatchImport] ${msg}`);
        return { totalRows: 0, inserted: 0, failed: 0, errors: [msg] };
      }

      // Insert batch directly to ClickHouse
      try {
        const transactionTable = getTable("Transaction");
        if (!transactionTable) {
          throw new Error("Transaction table not found");
        }
        const result = await transactionTable.insert(rows as any);
        console.log(`[BatchImport] Insert result:`, result);

        return {
          totalRows: rows.length,
          inserted: rows.length,
          failed: 0,
          errors: [],
        };
      } catch (err) {
        const msg = `Batch insert failed: ${err}`;
        console.error(`[BatchImport] ${msg}`);
        errors.push(msg);

        return {
          totalRows: rows.length,
          inserted: 0,
          failed: rows.length,
          errors,
        };
      }
    },
  },
);

/**
 * Batch Import Workflow
 * Orchestrates the batch import process
 */
export const batchImportWorkflow = new Workflow("batch-import", {
  startingTask: batchImportTask,
});
