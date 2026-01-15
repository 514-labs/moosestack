/**
 * Batch Import Test Script
 *
 * Tests reading CSV and inserting transactions via the ingest API.
 * This validates our data format before converting to a workflow.
 *
 * Usage: npx ts-node scripts/batch-import-test.ts
 */

import * as fs from "fs";
import * as path from "path";

const CONFIG = {
  baseUrl: process.env.MOOSE_URL || "http://localhost:4000",
  csvPath: path.join(__dirname, "../data/sample-transactions.csv"),
};

interface TransactionRow {
  transactionId: string;
  customerId: string;
  sessionId: string;
  timestamp: string;
  orderState: string;
  status: string;
  source: string;
  subtotal: string;
  discountAmount: string;
  taxAmount: string;
  shippingAmount: string;
  tipAmount: string;
  totalAmount: string;
  currency: string;
  paymentMethod: string;
  couponCode: string;
  itemCount: string;
  shippingCountry: string;
  shippingCity: string;
  isFirstPurchase: string;
  attributionChannel: string;
}

function parseCSV(content: string): TransactionRow[] {
  const lines = content.trim().split("\n");
  const headers = lines[0].split(",");

  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = values[i] || "";
    });
    return row as unknown as TransactionRow;
  });
}

function transformRow(row: TransactionRow) {
  return {
    transactionId: row.transactionId,
    customerId: row.customerId,
    sessionId: row.sessionId,
    timestamp: row.timestamp,
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
}

async function ingestTransaction(
  data: ReturnType<typeof transformRow>,
): Promise<boolean> {
  const url = `${CONFIG.baseUrl}/ingest/Transaction`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return response.ok;
  } catch (error) {
    console.error(`Failed to ingest ${data.transactionId}:`, error);
    return false;
  }
}

async function main() {
  console.log("=== Batch Import Test ===\n");

  // Read CSV
  console.log(`Reading CSV: ${CONFIG.csvPath}`);
  const content = fs.readFileSync(CONFIG.csvPath, "utf-8");
  const rows = parseCSV(content);
  console.log(`Found ${rows.length} transactions\n`);

  // Transform and insert
  let success = 0;
  let failed = 0;

  for (const row of rows) {
    const data = transformRow(row);
    console.log(`Inserting ${data.transactionId}...`);

    if (await ingestTransaction(data)) {
      success++;
      console.log(`  ✓ Success`);
    } else {
      failed++;
      console.log(`  ✗ Failed`);
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);

  // Verify in ClickHouse
  console.log(
    `\nVerify with: moose query "SELECT * FROM Transaction WHERE transactionId LIKE 'TXN-BATCH%'"`,
  );
}

main().catch(console.error);
