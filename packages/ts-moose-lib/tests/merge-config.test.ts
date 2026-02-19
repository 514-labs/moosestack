import { expect } from "chai";
import { IngestPipeline, OlapTable, ClickHouseEngines } from "../src";

interface TestEvent {
  event_id: string;
  user_id: string;
  event_type: string;
  amount: number;
  timestamp: number;
}

describe("Merge Engine Configuration", () => {
  it("should reject Merge engine in IngestPipeline", () => {
    expect(
      () =>
        new IngestPipeline<TestEvent>("guarded", {
          table: {
            engine: ClickHouseEngines.Merge,
            sourceDatabase: "currentDatabase()",
            tablesRegexp: "^events_.*$",
          },
          stream: true,
          ingestApi: true,
        }),
    ).to.throw(/Merge engine/);
  });
});
