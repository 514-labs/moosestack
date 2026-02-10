/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

describe("WebSocket Ingestion Example Smoke", function () {
  this.timeout(30_000);

  const exampleRoot = path.resolve(
    __dirname,
    "../../../examples/websocket-ingestion-poc/moose",
  );

  it("should include shared primitive, connector composition, and source adapters", async function () {
    const expectedPaths = [
      "README.md",
      "app/connectors/shared/durable-pipeline/runner.ts",
      "app/connectors/shared/durable-pipeline/types.ts",
      "app/connectors/shared/durable-pipeline/checkpoint-store.ts",
      "app/connectors/shared/durable-pipeline/sink-writer.ts",
      "app/connectors/shared/durable-pipeline/connector-pipeline.ts",
      "app/connectors/shared/durable-pipeline/connector-definition.ts",
      "app/connectors/shared/durable-pipeline/source-definition.ts",
      "app/connectors/shared/durable-pipeline/pipeline-workflow.ts",
      "app/connectors/shared/durable-pipeline/backoff.ts",
      "app/connectors/shared/durable-pipeline/disconnect-signal.ts",
      "app/connectors/shared/durable-pipeline/event-processor.ts",
      "app/connectors/shared/durable-pipeline/run-loop.ts",
      "app/connectors/supabase/connector.ts",
      "app/connectors/supabase/source.ts",
      "app/connectors/supabase/sinks.ts",
      "app/connectors/coinbase/connector.ts",
      "app/connectors/coinbase/source.ts",
      "app/connectors/coinbase/sinks.ts",
    ];

    for (const relativePath of expectedPaths) {
      const absolutePath = path.join(exampleRoot, relativePath);
      expect(
        fs.existsSync(absolutePath),
        `Expected file to exist: ${relativePath}`,
      ).to.equal(true);
    }

    const rootReadme = fs.readFileSync(
      path.join(exampleRoot, "README.md"),
      "utf8",
    );
    expect(rootReadme).to.include("durable-pipeline/runner.ts");
    expect(rootReadme).to.include("supabase/");
    expect(rootReadme).to.include("coinbase/");

    const coinbaseConnector = fs.readFileSync(
      path.join(exampleRoot, "app/connectors/coinbase/connector.ts"),
      "utf8",
    );
    expect(coinbaseConnector).to.include("defineConnector");
    expect(coinbaseConnector).to.include("coinbaseSource");
    expect(coinbaseConnector).to.include("createCoinbasePipeline");
    expect(coinbaseConnector).to.include("coinbaseTradesListenerWorkflow");
    expect(coinbaseConnector).not.to.include("createSource:");
    expect(coinbaseConnector).not.to.include("createCoinbaseSource");

    const coinbaseSource = fs.readFileSync(
      path.join(exampleRoot, "app/connectors/coinbase/source.ts"),
      "utf8",
    );
    expect(coinbaseSource).to.include("defineSource");
    expect(coinbaseSource).to.include("export const coinbaseSource");

    const supabaseConnector = fs.readFileSync(
      path.join(exampleRoot, "app/connectors/supabase/connector.ts"),
      "utf8",
    );
    expect(supabaseConnector).to.include("defineConnector");
    expect(supabaseConnector).to.include("supabaseSource");
    expect(supabaseConnector).to.include("createSupabasePipeline");
    expect(supabaseConnector).to.include("supabaseCdcListenerWorkflow");
    expect(supabaseConnector).not.to.include("createSource:");

    const coinbaseSinks = fs.readFileSync(
      path.join(exampleRoot, "app/connectors/coinbase/sinks.ts"),
      "utf8",
    );
    expect(coinbaseSinks).to.include("COINBASE_RESOURCES");
    expect(coinbaseSinks).not.to.include("defineConnectorSinks");
    expect(coinbaseSinks).not.to.include("_INTERNAL");

    const supabaseSinks = fs.readFileSync(
      path.join(exampleRoot, "app/connectors/supabase/sinks.ts"),
      "utf8",
    );
    expect(supabaseSinks).to.include("SUPABASE_RESOURCES");
    expect(supabaseSinks).not.to.include("defineConnectorSinks");
    expect(supabaseSinks).not.to.include("_INTERNAL");

    const supabaseSource = fs.readFileSync(
      path.join(exampleRoot, "app/connectors/supabase/source.ts"),
      "utf8",
    );
    expect(supabaseSource).to.include("resource:");
    expect(supabaseSource).to.include("checkpoint:");

    const coinbaseSourceEnvelope = fs.readFileSync(
      path.join(exampleRoot, "app/connectors/coinbase/source.ts"),
      "utf8",
    );
    expect(coinbaseSourceEnvelope).to.include("resource:");
    expect(coinbaseSourceEnvelope).to.include("checkpoint:");
  });
});
