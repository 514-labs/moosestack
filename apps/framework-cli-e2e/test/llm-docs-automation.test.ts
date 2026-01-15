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
import { cleanupDocker } from "./utils/docker-utils";
import { runAgent, AgentResult } from "./utils/llm-agent-utils";
import { logger } from "./utils/logger";
import { sendPostHogEvent } from "./utils/posthog-utils";
import { killRemainingProcesses } from "./utils/process-utils";

const testLogger = logger.scope("llm-docs-automation");

describe("LLM Documentation Automation", function () {
  this.timeout(600000);

  const testProjectPath = "/tmp/llm-test-moose-project";
  const appName = "llm-test-moose-project";
  const TEST_LANGUAGE = process.env.LLM_TEST_LANGUAGE;

  async function cleanupTestProject() {
    testLogger.info("🧹 Starting cleanup...");

    await killRemainingProcesses({ logger: testLogger });

    if (fs.existsSync(testProjectPath)) {
      await cleanupDocker(testProjectPath, appName, { logger: testLogger });
      testLogger.info(`🧹 Removing test project: ${testProjectPath}`);
      fs.rmSync(testProjectPath, { recursive: true, force: true });
    }
  }

  before(async function () {
    if (!TEST_LANGUAGE || !["typescript", "python"].includes(TEST_LANGUAGE)) {
      testLogger.warn(
        `⚠️  LLM_TEST_LANGUAGE must be "typescript" or "python", got: ${TEST_LANGUAGE}`,
      );
      this.skip();
    }

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
    const task = `Create a working ${TEST_LANGUAGE} Moose project from a template at ${testProjectPath} and verify it works by sending test data to it.

Search the documentation to learn how to install and use Moose.`;

    testLogger.info(`🚀 Starting LLM agent (${TEST_LANGUAGE}) with task:`);
    testLogger.info(`   ${task}`);

    const result: AgentResult = await runAgent(task, {
      workingDir: "/tmp",
    });

    // Log results
    testLogger.info("\n" + "=".repeat(50));
    testLogger.info(`Result: ${result.success ? "✅ Success" : "❌ Failed"}`);
    if (result.error) {
      testLogger.error(`Error: ${result.error}`);
    }

    // Log and send metrics
    result.metrics.logSummary(testLogger);
    await sendPostHogEvent({
      event: "test_llm_basic_moose_app",
      properties: result.metrics.toPostHogProperties(
        TEST_LANGUAGE!,
        result.success,
        result.error,
      ),
    });

    expect(result.success).to.be.true;
    expect(
      fs.existsSync(testProjectPath),
      "Project directory should be created",
    ).to.be.true;
  });
});
