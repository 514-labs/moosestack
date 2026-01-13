/// <reference types="node" />
/// <reference types="mocha" />
/// <reference types="chai" />

/**
 * LLM-Driven Documentation Automation Test
 *
 * This test validates that MooseStack documentation is complete and accurate enough
 * for AI agents to create, configure, and test a working Moose project from scratch.
 *
 * The test uses Claude (via Anthropic API) with access to:
 * - Context7 API for searching documentation
 * - Command execution to run moose CLI, npm, curl, etc.
 */

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { runAgent, AgentResult, formatDuration } from "./utils/llm-agent-utils";
import { logger } from "./utils/logger";
import { performGlobalCleanup } from "./utils/cleanup-utils";
import { sendPostHogEvent } from "./utils/posthog-utils";

const testLogger = logger.scope("llm-docs-automation");

describe("LLM Documentation Automation", function () {
  this.timeout(600000);

  const testProjectPath = "/tmp/llm-test-moose-project";
  const CLI_PATH = path.resolve(__dirname, "../../../target/debug/moose-cli");
  const TEST_LANGUAGE = process.env.LLM_TEST_LANGUAGE || "typescript";

  async function cleanupTestProject() {
    testLogger.info("🧹 Starting cleanup...");

    await performGlobalCleanup("LLM test cleanup");

    if (fs.existsSync(testProjectPath)) {
      testLogger.info(`🧹 Removing test project: ${testProjectPath}`);
      fs.rmSync(testProjectPath, { recursive: true, force: true });
    }
  }

  before(async function () {
    if (!process.env.ANTHROPIC_API_KEY) {
      testLogger.warn("⚠️  ANTHROPIC_API_KEY not set, skipping LLM tests");
      this.skip();
    }

    if (!process.env.CONTEXT7_API_KEY) {
      testLogger.warn("⚠️  CONTEXT7_API_KEY not set, skipping LLM tests");
      this.skip();
    }

    await cleanupTestProject();
  });

  after(async function () {
    this.timeout(60000);
    await cleanupTestProject();
  });

  it("should create a working Moose project from scratch using only documentation", async function () {
    const task = `Create a working ${TEST_LANGUAGE} Moose project at ${testProjectPath} and verify it works by sending test data to it.

IMPORTANT: Use ${CLI_PATH} for all moose CLI commands (e.g., "${CLI_PATH} init").`;

    testLogger.info(`🚀 Starting LLM agent (${TEST_LANGUAGE}) with task:`);
    testLogger.info(`   ${task}`);

    const result: AgentResult = await runAgent(task, {
      workingDir: "/tmp",
      maxIterations: 30,
      commandTimeout: 60000,
    });

    // Log results
    testLogger.info("\n" + "=".repeat(50));
    testLogger.info(`Result: ${result.success ? "✅ Success" : "❌ Failed"}`);
    testLogger.info(`LLM calls: ${result.iterations}`);
    if (result.error) {
      testLogger.error(`Error: ${result.error}`);
    }

    // Log metrics
    const metrics = result.metrics;
    testLogger.info("📊 Performance Metrics:");
    testLogger.info(
      `   Total duration: ${formatDuration(metrics.getTotalDuration())}`,
    );
    testLogger.info(
      `   Time to moose init: ${formatDuration(metrics.getTimeToMooseInit())}`,
    );
    testLogger.info(
      `   Time to moose dev: ${formatDuration(metrics.getTimeToMooseDev())}`,
    );
    testLogger.info(
      `   Time to test ingest: ${formatDuration(metrics.getTimeToIngest())}`,
    );
    testLogger.info(`   LLM calls: ${metrics.totalIterations}`);
    testLogger.info(`   Commands executed: ${metrics.totalCommands}`);
    testLogger.info(`   Doc searches: ${metrics.totalDocSearches}`);

    // Log phase breakdown
    if (metrics.phases.length > 0) {
      testLogger.info("📈 Phase Breakdown:");
      for (const phase of metrics.phases) {
        const duration =
          phase.duration ? formatDuration(phase.duration) : "in progress";
        testLogger.info(`   ${phase.phase}: ${duration}`);
      }
    }

    // Send metrics to PostHog
    await sendPostHogEvent({
      event: "llm_docs_automation_test",
      properties: {
        language: TEST_LANGUAGE,
        success: result.success,
        error: result.error,
        total_duration_ms: metrics.getTotalDuration(),
        total_duration_s:
          metrics.getTotalDuration() ?
            metrics.getTotalDuration()! / 1000
          : null,
        time_to_moose_init_ms: metrics.getTimeToMooseInit(),
        time_to_moose_dev_ms: metrics.getTimeToMooseDev(),
        time_to_ingest_ms: metrics.getTimeToIngest(),
        llm_calls: metrics.totalIterations,
        commands_executed: metrics.totalCommands,
        doc_searches: metrics.totalDocSearches,
        phases: metrics.phases.map((p) => ({
          phase: p.phase,
          duration_ms: p.duration ?? null,
        })),
      },
    });

    expect(result.success).to.be.true;
    expect(result.iterations).to.be.lessThan(30);
    expect(
      fs.existsSync(testProjectPath),
      "Project directory should be created",
    ).to.be.true;
  });
});
