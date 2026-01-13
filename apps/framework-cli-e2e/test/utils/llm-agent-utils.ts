/**
 * LLM Agent utilities for automating Moose project creation and testing.
 *
 * Uses Anthropic's Tool Use API to have an LLM execute commands and search documentation.
 */

import Anthropic from "@anthropic-ai/sdk";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import { searchMooseDocs } from "./context7-utils";
import { logger } from "./logger";

const execAsync = promisify(exec);

const agentLogger = logger.scope("llm-agent");

/**
 * Format milliseconds into human-readable duration
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) {
    return "N/A";
  }

  const totalSeconds = ms / 1000;

  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);

  return `${minutes}m ${seconds}s`;
}

export interface CommandResult {
  success: boolean;
  stdout: string;
  stderr: string;
  returncode: number;
}

export interface AgentConfig {
  anthropicApiKey?: string;
  context7ApiKey?: string;
  workingDir: string;
  maxIterations?: number;
  commandTimeout?: number; // milliseconds
}

/**
 * Metrics for a single command execution
 */
export interface CommandMetric {
  command: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  iteration: number;
}

/**
 * Metrics for a single documentation search
 */
export interface DocSearchMetric {
  query: string;
  timestamp: number;
  success: boolean;
  resultSize?: number;
  iteration: number;
}

/**
 * Metrics for a high-level phase (e.g., "moose_init", "moose_dev")
 */
export interface PhaseMetric {
  phase: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  commandsExecuted: number;
}

/**
 * Tracks metrics for an LLM agent run.
 * Automatically detects phases based on commands executed.
 */
export class AgentMetrics {
  startTime: number;
  endTime?: number;

  // Raw events
  commands: CommandMetric[] = [];
  docSearches: DocSearchMetric[] = [];
  phases: PhaseMetric[] = [];

  // Counters
  totalIterations: number = 0;
  totalDocSearches: number = 0;
  totalCommands: number = 0;

  // Track current phase
  private currentPhase?: PhaseMetric;

  constructor() {
    this.startTime = Date.now();
  }

  /**
   * Record a command execution
   */
  recordCommand(
    cmd: string,
    iteration: number,
    startTime: number,
    endTime: number,
    success: boolean,
  ): void {
    this.commands.push({
      command: cmd,
      startTime,
      endTime,
      duration: endTime - startTime,
      success,
      iteration,
    });
    this.totalCommands++;

    // Auto-detect phases based on commands
    this.detectPhase(cmd, endTime);
  }

  /**
   * Record a documentation search
   */
  recordDocSearch(
    query: string,
    iteration: number,
    success: boolean,
    resultSize?: number,
  ): void {
    this.docSearches.push({
      query,
      timestamp: Date.now(),
      success,
      resultSize,
      iteration,
    });
    this.totalDocSearches++;
  }

  /**
   * Mark test completion
   */
  markComplete(): void {
    this.endTime = Date.now();

    // Close any open phase
    if (this.currentPhase && !this.currentPhase.endTime) {
      this.currentPhase.endTime = this.endTime;
      this.currentPhase.duration =
        this.currentPhase.endTime - this.currentPhase.startTime;
    }
  }

  /**
   * Auto-detect phases from commands (each phase only starts once)
   */
  private detectPhase(cmd: string, timestamp: number): void {
    if (cmd.includes("moose-cli") && cmd.includes("init")) {
      this.startPhaseOnce("moose_init", timestamp);
    } else if (cmd.includes("npm install") || cmd.includes("pnpm install")) {
      this.endPhase("moose_init", timestamp);
      this.startPhaseOnce("npm_install", timestamp);
    } else if (cmd.includes("moose-cli") && cmd.includes("dev")) {
      this.endPhase("npm_install", timestamp);
      this.startPhaseOnce("moose_dev", timestamp);
    } else if (cmd.includes("curl") && cmd.includes("ingest")) {
      this.endPhase("moose_dev", timestamp);
      this.startPhaseOnce("test_ingest", timestamp);
    }
  }

  /**
   * Start a phase only if it hasn't been started already
   */
  private startPhaseOnce(name: string, timestamp: number): void {
    // Skip if this phase already exists
    if (this.phases.some((p) => p.phase === name)) {
      return;
    }
    this.currentPhase = {
      phase: name,
      startTime: timestamp,
      commandsExecuted: 0,
    };
    this.phases.push(this.currentPhase);
  }

  /**
   * End the current phase
   */
  private endPhase(expectedName: string, timestamp: number): void {
    if (this.currentPhase && this.currentPhase.phase === expectedName) {
      this.currentPhase.endTime = timestamp;
      this.currentPhase.duration = timestamp - this.currentPhase.startTime;
    }
  }

  /**
   * Get time from start to moose init completion
   */
  getTimeToMooseInit(): number | null {
    const phase = this.phases.find((p) => p.phase === "moose_init");
    return phase?.endTime ? phase.endTime - this.startTime : null;
  }

  /**
   * Get time from start to moose dev start
   */
  getTimeToMooseDev(): number | null {
    const phase = this.phases.find((p) => p.phase === "moose_dev");
    return phase ? phase.startTime - this.startTime : null;
  }

  /**
   * Get time from start to test ingest
   */
  getTimeToIngest(): number | null {
    const phase = this.phases.find((p) => p.phase === "test_ingest");
    return phase ? phase.startTime - this.startTime : null;
  }

  /**
   * Get total duration
   */
  getTotalDuration(): number {
    return (this.endTime || Date.now()) - this.startTime;
  }

  /**
   * Serialize to JSON for storage/reporting
   */
  toJSON() {
    return {
      startTime: this.startTime,
      endTime: this.endTime,
      totalDuration: this.getTotalDuration(),
      totalIterations: this.totalIterations,
      totalCommands: this.totalCommands,
      totalDocSearches: this.totalDocSearches,
      commands: this.commands,
      docSearches: this.docSearches,
      phases: this.phases,
      timeToMooseInit: this.getTimeToMooseInit(),
      timeToMooseDev: this.getTimeToMooseDev(),
      timeToIngest: this.getTimeToIngest(),
    };
  }
}

export interface AgentResult {
  success: boolean;
  iterations: number;
  error?: string;
  metrics: AgentMetrics;
}

/**
 * Check if a command is trying to background a process.
 * Looks for patterns like "cmd &" or "cmd > file 2>&1 &"
 */
function isBackgroundCommand(cmd: string): boolean {
  // Match & at end of a line (possibly with trailing whitespace)
  return /&\s*($|\n)/m.test(cmd);
}

/**
 * These are filtered out of the environment to prevent accidental or intentional leakage.
 */
const SECRET_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "CONTEXT7_API_KEY",
  "POSTHOG_API_KEY",
  "GITHUB_TOKEN",
  "OP_SERVICE_ACCOUNT_TOKEN",
];

/**
 * Build a safe environment for LLM command execution.
 * Filters out sensitive environment variables to prevent secret leakage.
 */
function getSafeEnv(): NodeJS.ProcessEnv {
  const safeEnv: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (SECRET_ENV_VARS.includes(key)) {
      continue;
    }

    if (
      key.includes("API_KEY") ||
      key.includes("SECRET") ||
      key.includes("TOKEN") ||
      key.includes("PASSWORD") ||
      key.includes("CREDENTIAL")
    ) {
      continue;
    }
    safeEnv[key] = value;
  }

  return safeEnv;
}

/**
 * Execute a bash command and return structured results.
 * Handles backgrounded commands specially using spawn with detached mode.
 */
async function runCommand(
  cmd: string,
  cwd: string,
  timeoutMs: number,
): Promise<CommandResult> {
  // If command contains backgrounding (&), use spawn with detached process group
  // Use a shorter timeout since we just need the shell to start the background process
  const isBg = isBackgroundCommand(cmd);
  agentLogger.info(`🔍 Background command detection: ${isBg}`);

  if (isBg) {
    // Background commands get 10 seconds max - enough to start the process and get initial output
    const bgTimeout = Math.min(timeoutMs, 10000);
    agentLogger.info(
      `⚡ Using spawn with detached mode for background command (${bgTimeout}ms timeout)`,
    );
    return new Promise((resolve) => {
      const child = spawn("sh", ["-c", cmd], {
        cwd,
        detached: true, // Create new process group
        stdio: ["ignore", "pipe", "pipe"],
        env: getSafeEnv(),
      });

      let stdout = "";
      let stderr = "";
      let resolved = false;

      child.stdout?.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      // For background commands, wait a short time for initial output then return
      // WITHOUT killing the process group - we want the backgrounded process to continue
      agentLogger.info(`⏱️ Setting background command timeout: ${bgTimeout}ms`);
      const timeout = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        agentLogger.info(
          `⏰ Background command timeout - returning without killing (letting background process continue)`,
        );
        // DON'T kill - the backgrounded process should keep running
        resolve({ success: true, stdout, stderr, returncode: 0 });
      }, bgTimeout);

      child.on("close", (code) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        agentLogger.info(
          `🔚 Background command child closed with code: ${code}`,
        );
        resolve({
          success: code === 0 || code === null,
          stdout,
          stderr,
          returncode: code ?? 0,
        });
      });

      // Unref so Node doesn't wait for this process
      child.unref();
    });
  }

  // Normal command - use exec
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      env: getSafeEnv(),
    });

    return {
      success: true,
      stdout,
      stderr,
      returncode: 0,
    };
  } catch (error: any) {
    return {
      success: false,
      stdout: error.stdout || "",
      stderr: error.stderr || error.message || "",
      returncode: error.code || -1,
    };
  }
}

/**
 * Get tool definitions for the LLM.
 */
function getTools(workingDir: string): Anthropic.Tool[] {
  return [
    {
      name: "search_docs",
      description:
        "Search MooseStack documentation for information. Use this BEFORE running commands to learn how to use Moose. Returns relevant documentation snippets.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "What to search for (e.g., 'how to initialize moose project', 'start moose dev server')",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "execute_command",
      description: `Execute a bash command in ${workingDir}. Returns output, error, and exit code.`,
      input_schema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The bash command to execute",
          },
        },
        required: ["command"],
      },
    },
  ];
}

/**
 * Run the LLM agent to accomplish a task using tool calls.
 */
export async function runAgent(
  task: string,
  config: AgentConfig,
): Promise<AgentResult> {
  const {
    anthropicApiKey = process.env.ANTHROPIC_API_KEY,
    context7ApiKey = process.env.CONTEXT7_API_KEY,
    workingDir,
    maxIterations = 30,
    commandTimeout = 60000,
  } = config;

  if (!anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY not set");
  }

  const client = new Anthropic({ apiKey: anthropicApiKey });
  const tools = getTools(workingDir);
  const metrics = new AgentMetrics();

  const systemPrompt = `You are an AI assistant helping a user use MooseStack.

You have access to two tools:
1. search_docs - Search MooseStack documentation. USE THIS FIRST to learn how to accomplish tasks.
2. execute_command - Run bash commands.

Always search the docs before running commands to learn the correct syntax and patterns.`;

  const userMessage = `Accomplish this task:

${task}

You'll need to figure out the steps yourself by searching the documentation. Use search_docs to learn what you need to do, then use execute_command to do it.

When you've completed the task, explain what you did.`;

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: userMessage,
    },
  ];

  agentLogger.info(`\n📋 System Prompt:\n${systemPrompt}`);
  agentLogger.info(`\n📝 User Message:\n${userMessage}`);

  let iteration = 0;

  try {
    while (iteration < maxIterations) {
      iteration++;
      metrics.totalIterations = iteration;
      agentLogger.info(`\n\n--- Iteration ${iteration} ---`);

      // Get LLM response
      const response = await client.messages.create({
        model: "claude-opus-4-5-20251101",
        max_tokens: 4096,
        system: systemPrompt,
        tools,
        messages,
      });

      agentLogger.info(`🤖 Action: ${response.stop_reason}`);

      // Check if we're done
      if (response.stop_reason === "end_turn") {
        for (const content of response.content) {
          if (content.type === "text") {
            agentLogger.info(`✅ Claude says: ${content.text}`);
          }
        }
        metrics.markComplete();
        return { success: true, iterations: iteration, metrics };
      } else if (response.stop_reason === "tool_use") {
        messages.push({
          role: "assistant",
          content: response.content,
        });

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const contentBlock of response.content) {
          if (contentBlock.type === "tool_use") {
            const toolName = contentBlock.name;
            agentLogger.info(`🔧 Tool: ${toolName}`);

            let result: any;

            if (toolName === "search_docs") {
              const query = (contentBlock.input as any).query;
              agentLogger.info(`🔍 Searching: ${query}`);

              const searchResult = await searchMooseDocs(query, context7ApiKey);

              // Record metrics
              metrics.recordDocSearch(
                query,
                iteration,
                searchResult.success,
                searchResult.success ? searchResult.content.length : undefined,
              );

              if (searchResult.success) {
                const contentLen = searchResult.content.length;
                agentLogger.info(`✅ Found docs (${contentLen} chars)`);
                agentLogger.info(
                  `   Preview: ${searchResult.content.substring(0, 150)}...`,
                );
                result = searchResult;
              } else {
                agentLogger.error(`❌ Search failed: ${searchResult.error}`);
                result = searchResult;
              }
            } else if (toolName === "execute_command") {
              const cmd = (contentBlock.input as any).command;
              agentLogger.info(`💻 Command: ${cmd}`);

              const startTime = Date.now();
              result = await runCommand(cmd, workingDir, commandTimeout);
              const endTime = Date.now();

              // Record metrics
              metrics.recordCommand(
                cmd,
                iteration,
                startTime,
                endTime,
                result.success,
              );

              if (result.success) {
                agentLogger.info(`✅ Success`);
                if (result.stdout) {
                  agentLogger.info(
                    `Output: ${result.stdout.substring(0, 200)}`,
                  );
                }
              } else {
                agentLogger.error(`❌ Failed (code ${result.returncode})`);
                if (result.stderr) {
                  agentLogger.error(
                    `Error: ${result.stderr.substring(0, 200)}`,
                  );
                }
              }
            } else {
              result = { success: false, error: `Unknown tool: ${toolName}` };
              agentLogger.error(`❌ Error: Unknown tool ${toolName}`);
            }

            // Package results for LLM
            toolResults.push({
              type: "tool_result",
              tool_use_id: contentBlock.id,
              content: JSON.stringify(result),
            });
          }
        }

        // Send results back to LLM
        messages.push({
          role: "user",
          content: toolResults,
        });
      } else {
        agentLogger.warn(`⚠️  Unexpected stop reason: ${response.stop_reason}`);
        if (response.content && response.content[0]?.type === "text") {
          agentLogger.info(
            `🤖 Claude said: ${response.content[0].text.substring(0, 200)}...`,
          );
        }
        metrics.markComplete();
        return {
          success: false,
          iterations: iteration,
          error: "unexpected_stop_reason",
          metrics,
        };
      }
    }

    agentLogger.warn(`⚠️  Max iterations (${maxIterations}) reached`);
    metrics.markComplete();
    return {
      success: false,
      iterations: iteration,
      error: "max_iterations",
      metrics,
    };
  } catch (error: any) {
    agentLogger.error(`❌ Agent error: ${error.message}`);
    metrics.markComplete();
    return {
      success: false,
      iterations: iteration,
      error: error.message || "unknown_error",
      metrics,
    };
  }
}
