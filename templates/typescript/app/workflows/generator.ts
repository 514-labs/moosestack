import { Task, Workflow, OlapTable, Key } from "@514labs/moose-lib";
import { Foo } from "../ingest/models";
import { faker } from "@faker-js/faker";

// Data model for OLAP Table
interface FooWorkflow {
  id: Key<string>;
  success: boolean;
  message: string;
}

// Create OLAP Table
const workflowTable = new OlapTable<FooWorkflow>("FooWorkflow");

// onComplete task that runs after ingest finishes
// Demonstrates how to schedule follow-up actions when a workflow task completes
const notifyComplete = new Task<number, void>("notifyComplete", {
  run: async ({ input }) => {
    console.log(
      `✅ Workflow completed! Successfully ingested ${input} records`,
    );

    // This is where you can trigger any post-completion actions:
    // - Send a webhook notification to an external service
    // - Post an event to trigger another workflow
    // - Update a status dashboard
    // - Send alerts or notifications
    // - Example:
    //   await fetch("https://your-webhook-endpoint.com/workflow-complete", {
    //     method: "POST",
    //     body: JSON.stringify({ recordsIngested: input, timestamp: Date.now() })
    //   });
  },
  retries: 2,
  timeout: "10s",
});

export const ingest = new Task<null, number>("ingest", {
  run: async () => {
    let recordCount = 0;
    for (let i = 0; i < 1000; i++) {
      const foo: Foo = {
        primaryKey: faker.string.uuid(),
        timestamp: Math.floor(
          faker.date.recent({ days: 365 }).getTime() / 1000,
        ), // Convert milliseconds to seconds
        optionalText: Math.random() < 0.5 ? faker.lorem.text() : undefined,
      };

      try {
        const response = await fetch("http://localhost:4000/ingest/Foo", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(foo),
        });

        if (!response.ok) {
          console.log(
            `Failed to ingest record ${i}: ${response.status} ${response.statusText}`,
          );
          // Insert ingestion result into OLAP table
          workflowTable.insert([
            { id: "1", success: false, message: response.statusText },
          ]);
        } else {
          recordCount++;
        }
      } catch (error) {
        console.log(`Error ingesting record ${i}: ${error}`);
        workflowTable.insert([
          { id: "1", success: false, message: error.message },
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
    return recordCount;
  },
  onComplete: [notifyComplete],
  retries: 3,
  timeout: "30s",
});

export const workflow = new Workflow("generator", {
  startingTask: ingest,
  retries: 3,
  timeout: "30s",
  // schedule: "@every 5s",
});
