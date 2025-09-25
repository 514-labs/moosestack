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

export const ingest = new Task<null, void>("ingest", {
  run: async () => {
    for (let i = 0; i < 1000; i++) {
      const foo: Foo = {
        primaryKey: faker.string.uuid(),
        timestamp: faker.date.recent({ days: 365 }).getTime(),
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
