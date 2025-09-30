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
    for (let i = 0; i < 1000; i++) {
      const baseTimestamp = faker.date.recent({ days: 365 }).getTime();
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
