import { Task, Workflow, OlapTable, Key } from "@514labs/moose-lib";
import { DateAggregationTest } from "../ingest/dateAggregationModels";

// Data model for tracking workflow results
interface DateAggregationWorkflow {
  id: Key<string>;
  success: boolean;
  message: string;
}

// Create OLAP Table for workflow tracking
const workflowTable = new OlapTable<DateAggregationWorkflow>("DateAggregationWorkflow");

/**
 * Task that generates test data for Date aggregation testing
 * This validates that Date fields work correctly with argMax aggregation
 */
export const generateDateAggregationData = new Task<null, void>("generateDateAggregationData", {
  run: async () => {
    console.log("Starting Date Aggregation Data Generation");

    const categories = ["A", "B", "C"];
    
    for (let i = 0; i < 10; i++) {
      const category = categories[i % categories.length];
      const now = new Date();
      
      // Create test record for ingestion
      const testRecord: DateAggregationTest = {
        id: `test-${i}`,
        lastUpdated: now,
        value: Math.random() * 100,
        category: category,
      };

      try {
        const response = await fetch("http://localhost:4000/ingest/DateAggregationTest", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(testRecord),
        });

        if (!response.ok) {
          console.log(
            `Failed to ingest record ${i}: ${response.status} ${response.statusText}`,
          );
          workflowTable.insert([
            { id: `${i}`, success: false, message: response.statusText },
          ]);
        } else {
          console.log(`Generated test record ${i} for category ${category}`);
          workflowTable.insert([
            { id: `${i}`, success: true, message: `Generated record ${i}` },
          ]);
        }
      } catch (error) {
        console.error(`Failed to generate test record ${i}:`, error);
        workflowTable.insert([
          { id: `${i}`, success: false, message: error.message },
        ]);
      }

      // Small delay between records
      if (i % 5 === 0 && i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
  },
  retries: 3,
  timeout: "30s",
});

export const dateAggregationWorkflow = new Workflow("dateAggregationGenerator", {
  startingTask: generateDateAggregationData,
  retries: 3,
  timeout: "30s",
  // schedule: "@every 10s", // Uncomment to run periodically
});