import { Task, Workflow, OlapTable, Key } from "@514labs/moose-lib";
import { Foo, FooPipeline } from "../ingest/models";
import { faker } from "@faker-js/faker";

// Data model for OLAP Table
interface FooWorkflow {
  id: Key<string>;
  success: boolean;
  message: string;
}

// Create OLAP Table
const workflowTable = new OlapTable<FooWorkflow>("FooWorkflow");

export const ingest = new Task<null, void>("ingest", {
  run: async () => {
    // Use three fixed timestamps for E2E tests to add variability
    // while ensuring predictable results for consumption API tests
    const timestamps = [
      1739865600000, // Feb 18, 2025 00:00:00 UTC (day 18 - should NOT appear in day 19 queries)
      1739952000000, // Feb 19, 2025 00:00:00 UTC (day 19 - the target day for tests)
      1740038400000, // Feb 20, 2025 00:00:00 UTC (day 20 - should NOT appear in day 19 queries)
    ];

    for (let i = 0; i < 1000; i++) {
      // Cycle through the three timestamps to distribute data across days
      // This tests that aggregation and filtering work correctly
      const baseTimestamp = timestamps[i % 3];
      const fooHttp: Foo = {
        primaryKey: faker.string.uuid(),
        timestamp: baseTimestamp,
        optionalText:
          Math.random() < 0.5 ? "from_http\n" + faker.lorem.text() : undefined,
      };

      const fooSend: Foo = {
        primaryKey: faker.string.uuid(),
        timestamp: baseTimestamp,
        optionalText:
          Math.random() < 0.5 ? "from_send:\n" + faker.lorem.text() : undefined,
      };

      // HTTP ingest path
      try {
        const response = await fetch("http://localhost:4000/ingest/Foo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(fooHttp),
        });
        if (!response.ok) {
          workflowTable.insert([
            {
              id: "1",
              success: false,
              message: `HTTP ${response.status} ${response.statusText}`,
            },
          ]);
        }
      } catch (error) {
        workflowTable.insert([
          {
            id: "1",
            success: false,
            message: `HTTP error: ${(error as Error).message}`,
          },
        ]);
      }

      // Direct stream send path
      try {
        await FooPipeline.stream!.send(fooSend);
      } catch (error) {
        workflowTable.insert([
          {
            id: "1",
            success: false,
            message: `SEND error: ${(error as Error).message}`,
          },
        ]);
      }

      // Add a small delay to avoid overwhelming the server
      if (i % 100 === 0) {
        console.log(`Ingested ${i} records...`);
        workflowTable.insert([
          { id: "1", success: true, message: `Ingested ${i} records` },
        ]);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  },
  retries: 3,
  timeout: "30s",
});

export const workflow = new Workflow("generator", {
  startingTask: ingest,
  retries: 3,
  timeout: "30s",
  // schedule: "@every 5s",
});
