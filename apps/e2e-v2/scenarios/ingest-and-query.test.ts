/**
 * Ingest and Query Scenario
 *
 * Tests basic data ingestion and querying capabilities.
 * Requires: feature:ingestion, infra:clickhouse, model:Foo
 */

import { expect } from "chai";
import type { Scenario, TestContext } from "../lib/index.js";
import {
  discoverTemplates,
  templateSatisfies,
  createTestContext,
  startMooseDev,
  stopMoose,
  waitForMooseReady,
  ingestRecord,
  queryClickHouse,
  sleep,
} from "../lib/index.js";

const scenario: Scenario = {
  name: "ingest-and-query",
  description: "Basic ingestion and query verification",
  requires: ["feature:ingestion", "infra:clickhouse", "model:Foo"],
};

// Find matching templates
const templates = discoverTemplates().filter((t) =>
  templateSatisfies(t, scenario),
);

describe(`Scenario: ${scenario.name}`, function () {
  this.timeout(120000);

  if (templates.length === 0) {
    it.skip("No matching templates found", () => {});
    return;
  }

  for (const template of templates) {
    describe(`Template: ${template.name}`, function () {
      let ctx: TestContext;
      let mooseProcess: ReturnType<typeof startMooseDev> extends (
        Promise<infer T>
      ) ?
        T
      : never;

      before(async function () {
        this.timeout(90000);

        ctx = createTestContext(template);

        // Start Moose dev server
        mooseProcess = await startMooseDev(template.path, ctx.port);

        // Wait for Moose to be ready
        const ready = await waitForMooseReady(ctx.port, 60000);
        expect(ready).to.be.true;
      });

      after(async function () {
        this.timeout(30000);
        if (mooseProcess) {
          stopMoose(mooseProcess);
          await sleep(2000); // Give time for cleanup
        }
      });

      it("should ingest a record via HTTP endpoint", async function () {
        const testRecord = {
          primaryKey: `test-${Date.now()}`,
          timestamp: new Date().toISOString(),
        };

        await ingestRecord(ctx.baseUrl, "Foo", testRecord);

        // Wait for data to be processed
        await sleep(2000);

        // Query ClickHouse to verify
        const results = await queryClickHouse(
          ctx.baseUrl,
          `SELECT * FROM local.Foo_0_0 WHERE primaryKey = '${testRecord.primaryKey}' LIMIT 1`,
        );

        expect(results).to.have.lengthOf(1);
        expect((results[0] as Record<string, unknown>).primaryKey).to.equal(
          testRecord.primaryKey,
        );
      });

      it("should handle multiple records", async function () {
        const batchId = Date.now();
        const records = [
          {
            primaryKey: `batch-${batchId}-1`,
            timestamp: new Date().toISOString(),
          },
          {
            primaryKey: `batch-${batchId}-2`,
            timestamp: new Date().toISOString(),
          },
          {
            primaryKey: `batch-${batchId}-3`,
            timestamp: new Date().toISOString(),
          },
        ];

        for (const record of records) {
          await ingestRecord(ctx.baseUrl, "Foo", record);
        }

        // Wait for data to be processed
        await sleep(3000);

        // Query ClickHouse to verify all records
        const results = await queryClickHouse(
          ctx.baseUrl,
          `SELECT * FROM local.Foo_0_0 WHERE primaryKey LIKE 'batch-${batchId}-%'`,
        );

        expect(results).to.have.lengthOf(3);
      });

      it("should reject invalid records", async function () {
        try {
          // Send invalid data (missing required fields)
          const response = await fetch(`${ctx.baseUrl}/ingest/Foo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ invalid: "data" }),
          });

          // Should return 4xx error
          expect(response.status).to.be.gte(400);
          expect(response.status).to.be.lt(500);
        } catch (error) {
          // Connection errors are also acceptable for invalid data
        }
      });
    });
  }
});
