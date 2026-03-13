/**
 * Tests the standalone getMooseUtils({ rlsContext }) path against live ClickHouse.
 * Run from the project root after moose dev is running and data is ingested.
 * Exits 0 on success, non-zero on failure.
 */
await import("../dist/app/index.js");
import { getMooseUtils } from "@514labs/moose-lib";

let failures = 0;
const fail = (msg, detail) => {
  console.error(`FAIL: ${msg}${detail ? " — " + detail : ""}`);
  failures++;
};

// 1. No rlsContext — should see all orgs
const { client, sql } = await getMooseUtils();
const allRows = await (
  await client.query.execute(sql`SELECT DISTINCT org_id FROM TenantEvent`)
).json();
if (allRows.length < 2) fail("no rlsContext", `expected >=2 orgs, got ${allRows.length}`);

// 2. rlsContext filters by org_id + data (AND semantics)
const scoped = await getMooseUtils({ rlsContext: { org_id: "acme", data: "acme-1" } });
const scopedRows = await (
  await scoped.client.query.execute(sql`SELECT * FROM TenantEvent`)
).json();
if (scopedRows.length !== 1 || scopedRows[0].org_id !== "acme" || scopedRows[0].data !== "acme-1") {
  fail("AND semantics", `expected 1 acme/acme-1 row, got ${scopedRows.length}`);
}

// 3. Missing claim → ClickHouse error
try {
  const partial = await getMooseUtils({ rlsContext: { org_id: "acme" } });
  await partial.client.query.execute(sql`SELECT * FROM TenantEvent`);
  fail("missing claim", "expected ClickHouse error for missing data claim");
} catch (_e) {
  // expected
}

// 4. Multi-DB: analytics table with org_id only
const analytics = await getMooseUtils({ rlsContext: { org_id: "acme" } });
const analyticsRows = await (
  await analytics.client.query.execute(sql`SELECT * FROM analytics.AnalyticsTenantEvent`)
).json();
if (analyticsRows.length !== 1 || analyticsRows[0].org_id !== "acme") {
  fail("multi-db", `expected 1 acme row, got ${analyticsRows.length}`);
}

// 5. Non-RLS table with rlsContext — no filtering
const pub = await getMooseUtils({ rlsContext: { org_id: "acme", data: "acme-1" } });
const pubRows = await (
  await pub.client.query.execute(sql`SELECT * FROM PublicEvent`)
).json();
if (pubRows.length !== 2) fail("non-RLS table", `expected 2 rows, got ${pubRows.length}`);

if (failures > 0) {
  console.error(`\n${failures} standalone test(s) failed`);
  process.exit(1);
} else {
  console.log("All standalone RLS tests passed");
  process.exit(0);
}
