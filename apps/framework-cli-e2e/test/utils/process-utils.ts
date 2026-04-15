import { TIMEOUTS, SERVER_CONFIG } from "../constants";
import { waitForConsumerGroupsStable } from "./kafka-utils";
import { logger, ScopedLogger } from "./logger";
import { ChildProcess } from "child_process";
import { TestPorts } from "./port-config";

const processLogger = logger.scope("utils:process");

export interface ProcessOptions {
  logger?: ScopedLogger;
  /** Override the base URL for server requests (default: SERVER_CONFIG.url) */
  baseUrl?: string;
  /** Skip Docker detection and use dockerless readiness checks directly */
  dockerless?: boolean;
  /** Override the Phase 3 stabilization delay in dockerless mode (default: 30_000ms).
   *  Use a shorter delay (e.g. 5_000) for schema-only tests that don't need
   *  streaming functions ready — they only verify DDL changes. */
  stabilizationDelayMs?: number;
  /** Restrict process cleanup to the suite's allocated ports. */
  ports?: TestPorts | number[];
}

declare const require: any;

const execAsync = (
  command: string,
  options?: any,
): Promise<{ stdout: string; stderr: string }> => {
  return new Promise((resolve, reject) => {
    require("child_process").exec(
      command,
      options || {},
      (error: any, stdout: string, stderr: string) => {
        if (error) return reject(error);
        resolve({ stdout, stderr });
      },
    );
  });
};

const setTimeoutAsync = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

const isDarwin = process.platform === "darwin";

const buildKillPortCommand = (port: number): string =>
  isDarwin ?
    `pids=$(lsof -ti tcp:${port} 2>/dev/null) && [ -n "$pids" ] && kill -9 $pids || true`
  : `fuser -k ${port}/tcp 2>/dev/null || true`;

const buildPortFreeCheckCommand = (port: number): string =>
  isDarwin ?
    `if lsof -ti tcp:${port} >/dev/null 2>&1; then echo busy; else echo free; fi`
  : `fuser ${port}/tcp 2>/dev/null || echo free`;

/**
 * Stops a moose process with graceful shutdown and forced termination fallback
 */
export const stopDevProcess = async (
  devProcess: ChildProcess | null,
  options: ProcessOptions = {},
): Promise<void> => {
  const log = options.logger ?? processLogger;

  if (devProcess && !devProcess.killed) {
    log.debug("Stopping moose server process");

    // Set up exit handler before killing
    const gracefulShutdownPromise = new Promise<void>((resolve) => {
      devProcess!.on("exit", () => {
        log.debug("Moose process has exited gracefully");
        resolve();
      });
    });

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        if (devProcess.exitCode === null) {
          log.warn("Moose process did not exit gracefully, forcing kill");
          devProcess!.kill("SIGKILL");
        }
        resolve();
      }, TIMEOUTS.PROCESS_TERMINATION_MS);
    });

    // Send SIGINT to trigger graceful shutdown
    devProcess.kill("SIGINT");

    // Race between graceful shutdown and timeout
    await Promise.race([gracefulShutdownPromise, timeoutPromise]);

    // Give a brief moment for cleanup after forced kill
    if (!devProcess.killed) {
      await setTimeoutAsync(TIMEOUTS.BRIEF_CLEANUP_WAIT_MS);
    }

    // Legacy CLIs can leave descendant processes briefly holding inherited
    // stdio pipes open after the main process exits. Explicitly destroy our
    // side of the streams so Node does not keep the test process alive
    // waiting on pipe handles that no longer matter for teardown.
    devProcess.stdout?.destroy();
    devProcess.stderr?.destroy();
    devProcess.stdin?.destroy();
    devProcess.removeAllListeners();

    log.debug("Ensuring all moose processes are terminated");
    await killRemainingProcesses(options);
  }
};

/**
 * Waits for the moose server to start by monitoring stdout and HTTP pings
 */
export const waitForServerStart = async (
  devProcess: ChildProcess,
  timeout: number,
  startupMessage: string,
  serverUrl: string,
  options: ProcessOptions = {},
): Promise<void> => {
  const log = options.logger ?? processLogger;

  return new Promise<void>((resolve, reject) => {
    let serverStarted = false;
    let timeoutId: any = null;
    let pingInterval: any = null;

    const cleanup = () => {
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      devProcess.stdout?.off("data", onStdout);
      devProcess.stderr?.off("data", onStderr);
      devProcess.off("exit", onExit);
    };

    const storedStdout: any[] = [];
    const onStdout = async (data: any) => {
      const output = data.toString();
      if (!output.match(/^\n[⢹⢺⢼⣸⣇⡧⡗⡏] Starting local infrastructure$/)) {
        log.debug("Moose server output", { output: output.trim() });
        if (!serverStarted) {
          storedStdout.push(output);
        }
      }

      if (!serverStarted && output.includes(startupMessage)) {
        serverStarted = true;
        log.debug("Server startup message detected");
        cleanup();
        resolve();
      }
    };

    const onStderr = (data: any) => {
      log.warn("Moose server stderr", { stderr: data.toString() });
    };

    const onExit = (code: number | null) => {
      log.debug(`Moose process exited`, { exitCode: code });
      if (!serverStarted) {
        cleanup();
        try {
          console.log("Moose server output:");
          storedStdout.forEach((data) => console.log(data));
        } catch {}
        reject(new Error(`Moose process exited with code ${code}`));
      } else {
        cleanup();
      }
    };

    devProcess.stdout?.on("data", onStdout);
    devProcess.stderr?.on("data", onStderr);
    devProcess.on("exit", onExit);

    // Fallback readiness probe: HTTP ping
    pingInterval = setInterval(async () => {
      if (serverStarted) {
        cleanup();
        return;
      }
      try {
        const res = await fetch(`${serverUrl}/ingest`);
        if (res.ok || [400, 404, 405].includes(res.status)) {
          serverStarted = true;
          cleanup();
          resolve();
        }
      } catch (_) {
        // ignore until service is up
      }
    }, 1000);

    timeoutId = setTimeout(() => {
      if (serverStarted) return;
      log.error("Moose server did not start or complete in time", {
        timeout,
        serverUrl,
      });
      devProcess.kill("SIGINT");
      cleanup();
      reject(new Error("Moose server timeout"));
    }, timeout);
  });
};

/**
 * Waits for infrastructure changes to be fully processed after a file modification.
 * This monitors the dev process stdout for the "Infrastructure changes processed successfully"
 * message that appears after the file watcher processes changes.
 *
 * @param devProcess - The child process running `moose dev`
 * @param timeoutMs - Maximum time to wait for infrastructure changes
 * @param options - Optional logger configuration
 */
export const waitForInfrastructureChanges = async (
  devProcess: ChildProcess,
  timeoutMs: number = 60_000,
  options: ProcessOptions = {},
): Promise<void> => {
  const log = options.logger ?? processLogger;
  const found = await waitForOutputMessage(
    devProcess,
    "Infrastructure changes processed successfully",
    timeoutMs,
    options,
  );
  if (found) {
    log.debug("✓ Infrastructure changes processed successfully");
  } else {
    throw new Error(
      "Infrastructure changes did not complete in time - check logs for details",
    );
  }
};

/**
 * Kills any remaining moose-cli processes and native infrastructure
 * (ClickHouse, Temporal) that may have been orphaned between test suites.
 *
 * Uses port-based killing to ensure stale processes don't hold ports across
 * sequential test suites without killing unrelated local Moose processes.
 */
export const killRemainingProcesses = async (
  options: ProcessOptions = {},
): Promise<void> => {
  const log = options.logger ?? processLogger;

  // Default infrastructure ports used when no override is provided.
  const defaultPorts = [18123, 19000, 9181, 9234, 19092, 16379, 7233];
  const rawPorts =
    Array.isArray(options.ports) ? options.ports
    : options.ports ? Object.values(options.ports)
    : defaultPorts;
  const portsToKill = [...new Set(rawPorts)];
  const portsToWait = portsToKill.filter((port) =>
    [18123, 19000, 9181, 9234, 19092, 16379, 7233].includes(port),
  );

  // Kill processes holding the specified ports.
  try {
    for (const port of portsToKill) {
      await execAsync(buildKillPortCommand(port), {
        timeout: TIMEOUTS.PROCESS_TERMINATION_MS,
        killSignal: "SIGKILL",
        windowsHide: true,
      });
    }
    log.debug("Killed processes on ports", { ports: portsToKill });
  } catch (error) {
    log.warn("Error killing processes by port");
  }

  // Wait for key ports to be released before returning.
  for (const port of portsToWait) {
    try {
      for (let i = 0; i < 10; i++) {
        const { stdout } = await execAsync(buildPortFreeCheckCommand(port), {
          timeout: 5000,
        });
        if (stdout.trim() === "free") {
          log.debug(`Port ${port} is free`);
          break;
        }
        log.debug(`Port ${port} still in use, waiting... (attempt ${i + 1})`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (error) {
      log.warn(`Error checking port ${port} availability`);
    }
  }
};

/**
 * Wait for streaming functions and ClickHouse sync to start.
 *
 * When `options.dockerless` is true, uses the /ready endpoint + ingest probe
 * directly (no Docker overhead). Otherwise checks Redpanda consumer groups
 * via `rpk group list` inside the Docker container.
 */
export const waitForStreamingFunctions = async (
  timeoutMs: number = 120000,
  options: ProcessOptions = {},
): Promise<void> => {
  const log = options.logger ?? processLogger;
  const baseUrl = options.baseUrl ?? SERVER_CONFIG.url;
  log.debug("Waiting for streaming functions to start", {
    timeoutMs,
    dockerless: !!options.dockerless,
  });

  if (options.dockerless) {
    await waitForStreamingDockerlessMode(
      timeoutMs,
      baseUrl,
      log,
      options.stabilizationDelayMs,
    );
    return;
  }

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const { stdout: containerName } = await execAsync(
        `docker ps --filter "label=com.docker.compose.service=redpanda" --format '{{.Names}}'`,
      );

      if (!containerName.trim()) {
        log.debug("Waiting for Redpanda container to start");
        await setTimeoutAsync(1000);
        continue;
      }

      const { stdout: groupList } = await execAsync(
        `docker exec ${containerName.trim()} rpk group list`,
      );

      log.debug("Redpanda consumer groups", { groupList: groupList.trim() });

      const lines = groupList.split("\n").slice(1);

      const flowGroups = lines.filter((line) => line.includes("flow-"));
      const stableFlowGroups = flowGroups.filter((line) =>
        line.includes("Stable"),
      );

      const clickhouseSyncGroups = lines.filter((line) =>
        line.includes("clickhouse_sync"),
      );
      const stableClickhouseSyncGroups = clickhouseSyncGroups.filter((line) =>
        line.includes("Stable"),
      );

      const hasAnyGroups =
        flowGroups.length > 0 || clickhouseSyncGroups.length > 0;
      const allFlowGroupsStable =
        flowGroups.length === 0 ||
        stableFlowGroups.length === flowGroups.length;
      const allClickhouseSyncGroupsStable =
        clickhouseSyncGroups.length === 0 ||
        stableClickhouseSyncGroups.length === clickhouseSyncGroups.length;

      if (
        hasAnyGroups &&
        allFlowGroupsStable &&
        allClickhouseSyncGroupsStable
      ) {
        log.debug(
          `Found ${stableFlowGroups.length} active streaming function(s) and ${stableClickhouseSyncGroups.length} clickhouse sync group(s)`,
          {
            functions: stableFlowGroups.map((g) => g.trim()),
            clickhouseSync: stableClickhouseSyncGroups.map((g) => g.trim()),
          },
        );

        log.debug("Waiting for consumer groups to stabilize");
        await setTimeoutAsync(3000);
        log.debug("✓ Streaming functions and ClickHouse sync ready");
        return;
      }

      log.debug(
        `Waiting for all groups to be stable (flow: ${stableFlowGroups.length}/${flowGroups.length}, clickhouse_sync: ${stableClickhouseSyncGroups.length}/${clickhouseSyncGroups.length})`,
      );
      await setTimeoutAsync(1000);
    } catch (error) {
      log.debug("Error checking consumer groups, retrying", {
        error: error instanceof Error ? error.message : String(error),
      });
      await setTimeoutAsync(1000);
    }
  }

  throw new Error(
    `Streaming functions and ClickHouse sync did not reach Stable state within ${timeoutMs / 1000}s`,
  );
};

/**
 * Dockerless mode readiness check: uses the /ready endpoint to verify all
 * infrastructure services are healthy, then verifies the ingest endpoint is
 * accepting data (proves Kafka producer path works), and waits for consumer
 * groups to stabilize.
 */
const DEFAULT_STABILIZATION_DELAY_MS = 30_000;

const waitForReadyStatus = async (
  budgetMs: number,
  baseUrl: string,
  log: ScopedLogger,
  mode: "core" | "all",
): Promise<void> => {
  const startTime = Date.now();
  const requiredServices =
    mode === "all" ?
      ["ClickHouse", "Redis", "Redpanda"]
    : ["ClickHouse", "Redis"];
  const description =
    mode === "all" ?
      "all infrastructure services"
    : "core infrastructure services";

  while (Date.now() - startTime < budgetMs) {
    try {
      const response = await fetch(`${baseUrl}/ready`);
      const body = await response.text();
      if (response.status === 200) {
        log.debug(`✓ ${description} healthy via /ready endpoint`);
        return;
      }

      try {
        const status = JSON.parse(body);
        const healthy: string[] = status.healthy ?? [];
        if (requiredServices.every((service) => healthy.includes(service))) {
          log.debug(
            `✓ ${description} healthy (${healthy.join(", ")}), proceeding despite overall ${response.status}`,
          );
          return;
        }
      } catch {
        // JSON parse failure — fall through to retry.
      }

      log.debug(`Infrastructure not ready (${response.status}): ${body}`);
    } catch (error) {
      log.debug("Error checking /ready endpoint, retrying", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await setTimeoutAsync(1000);
  }

  throw new Error(
    `${description} did not become ready within ${Math.floor(budgetMs / 1000)}s`,
  );
};

const waitForStreamingDockerlessMode = async (
  remainingMs: number,
  baseUrl: string,
  log: ScopedLogger,
  overrideStabilizationMs?: number,
): Promise<void> => {
  const startTime = Date.now();
  // Moderate stabilization delay after infrastructure reports healthy.
  // Consumer groups use auto.offset.reset=earliest, so data produced before
  // consumers join will still be consumed. Tests use generous waitForDBWrite
  // timeouts (120s) on top of this delay, giving a total consumer readiness
  // budget of ~150s.
  // Schema-only tests can pass a shorter delay since they only verify DDL.
  const STABILIZATION_DELAY_MS =
    overrideStabilizationMs ?? DEFAULT_STABILIZATION_DELAY_MS;
  const budgetMs = Math.max(0, remainingMs);

  if (budgetMs === 0) {
    throw new Error("No timeout budget left for dockerless readiness check");
  }

  // Phase 1: Poll /ready endpoint until the core local services are healthy.
  // In dockerless mode the rdkafka metadata health check (used by /ready for
  // Redpanda) is flaky with devkafka — the 2-second timeout is too tight for
  // a fresh BaseConsumer to connect + fetch metadata reliably. Rather than
  // blocking on full 200 OK, we accept the response once ClickHouse and Redis
  // are healthy and let Phase 3 verify Kafka via kafkajs.
  log.debug(
    "Phase 1: Waiting for infrastructure health via /ready endpoint (ClickHouse and Redis required)",
  );
  await waitForReadyStatus(budgetMs, baseUrl, log, "core");

  if (Date.now() - startTime >= budgetMs) {
    throw new Error(
      `Infrastructure did not become ready within the remaining timeout (dockerless mode)`,
    );
  }

  // Phase 2: Verify ingest endpoint is accepting data (proves Kafka producer path)
  log.debug("Phase 2: Verifying ingest endpoint accepts requests");
  let ingestReady = false;
  while (Date.now() - startTime < budgetMs) {
    try {
      const response = await fetch(`${baseUrl}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      // Any response (even 400/404) means the server is processing requests
      if (response.status !== 502 && response.status !== 503) {
        log.debug(`✓ Ingest endpoint responding (status: ${response.status})`);
        ingestReady = true;
        break;
      }
    } catch (error) {
      log.debug("Ingest endpoint not ready, retrying", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    await setTimeoutAsync(1000);
  }
  if (!ingestReady) {
    throw new Error(
      `Ingest endpoint did not become ready within the remaining timeout (dockerless mode)`,
    );
  }

  // Phase 3: Poll devkafka for consumer groups reaching Stable state.
  // devkafka now supports ListGroups/DescribeGroups, so we actively verify
  // consumer group state instead of using a blind delay. If polling fails
  // (e.g., streaming is disabled), falls back to a short delay.
  const elapsedMs = Date.now() - startTime;
  const remainingBudgetMs = Math.max(0, budgetMs - elapsedMs);
  if (remainingBudgetMs === 0) {
    throw new Error(
      "Timed out before consumer groups could stabilize (dockerless mode)",
    );
  }
  const pollTimeoutMs = Math.min(STABILIZATION_DELAY_MS, remainingBudgetMs);
  log.debug(
    `Phase 3: Polling consumer groups for Stable state (timeout: ${Math.floor(pollTimeoutMs / 1000)}s)`,
  );
  try {
    await waitForConsumerGroupsStable(pollTimeoutMs, { logger: log });
  } catch (error) {
    const fallbackMs = Math.min(5000, remainingBudgetMs);
    log.debug(
      `Consumer group polling ended: ${error instanceof Error ? error.message : String(error)}, using ${fallbackMs}ms fallback`,
    );
    await setTimeoutAsync(fallbackMs);
  }
  log.debug("✓ Streaming functions ready (dockerless mode)");
};

/**
 * Waits for all infrastructure components to be ready
 * Uses the /ready endpoint which checks Redis, Redpanda, ClickHouse, and Temporal
 */
export const waitForInfrastructureReady = async (
  timeoutMs: number = 120_000,
  options: ProcessOptions = {},
): Promise<void> => {
  const log = options.logger ?? processLogger;
  const baseUrl = options.baseUrl ?? SERVER_CONFIG.url;
  log.debug("Waiting for all infrastructure to be ready", {
    timeoutMs,
    baseUrl,
  });

  await waitForReadyStatus(timeoutMs, baseUrl, log, "all");
};

/**
 * Waits for one or more specific messages to appear in process output (stdout or stderr)
 *
 * @param devProcess - The child process to monitor
 * @param expectedMessages - A single string or array of strings to wait for
 * @param timeout - Maximum time to wait in milliseconds
 * @param options - Additional options including logger
 * @returns Promise<boolean> - true if all messages found, false if timeout occurs
 *
 * @example
 * // Wait for a single message
 * await waitForOutputMessage(process, "Server started", 5000);
 *
 * // Wait for multiple messages (avoids race conditions)
 * await waitForOutputMessage(process, ["Unloaded Files", "myfile.ts"], 5000);
 */
export const waitForOutputMessage = async (
  devProcess: ChildProcess,
  expectedMessages: string | string[],
  timeout: number,
  options: ProcessOptions = {},
): Promise<boolean> => {
  const log = options.logger ?? processLogger;
  const messagesToFind =
    Array.isArray(expectedMessages) ? expectedMessages : [expectedMessages];
  const messagesFound = new Set<string>();

  return new Promise<boolean>((resolve, reject) => {
    let timeoutId: any = null;
    let outputBuffer = "";

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      devProcess.stdout?.off("data", onStdout);
      devProcess.stderr?.off("data", onStderr);
      devProcess.off("exit", onExit);
    };

    const checkMessages = (output: string) => {
      // Check which messages are in the current output
      for (const message of messagesToFind) {
        if (output.includes(message) || outputBuffer.includes(message)) {
          messagesFound.add(message);
        }
      }

      // If all messages found, resolve
      if (messagesFound.size === messagesToFind.length) {
        log.debug("All expected messages found", {
          messages: messagesToFind,
        });
        cleanup();
        resolve(true);
      }
    };

    const onStdout = (data: any) => {
      const output = data.toString();
      outputBuffer += output;
      log.debug("Dev process stdout", { output: output.trim() });
      checkMessages(output);
    };

    const onStderr = (data: any) => {
      const output = data.toString();
      outputBuffer += output;
      log.debug("Dev process stderr", { stderr: output.trim() });
      checkMessages(output);
    };

    const onExit = (code: number | null) => {
      cleanup();
      if (messagesFound.size < messagesToFind.length) {
        const missingMessages = messagesToFind.filter(
          (msg) => !messagesFound.has(msg),
        );
        log.error("Process exited without finding all messages", {
          exitCode: code,
          found: Array.from(messagesFound),
          missing: missingMessages,
          outputBuffer: outputBuffer.slice(0, 1000),
        });
        reject(
          new Error(
            `Process exited with code ${code} before all messages were found. Missing: ${missingMessages.join(", ")}`,
          ),
        );
      }
    };

    devProcess.stdout?.on("data", onStdout);
    devProcess.stderr?.on("data", onStderr);
    devProcess.on("exit", onExit);

    timeoutId = setTimeout(() => {
      cleanup();
      if (messagesFound.size < messagesToFind.length) {
        const missingMessages = messagesToFind.filter(
          (msg) => !messagesFound.has(msg),
        );
        log.error("Timeout waiting for messages", {
          expectedMessages: messagesToFind,
          found: Array.from(messagesFound),
          missing: missingMessages,
          receivedOutput: outputBuffer.slice(0, 1000),
        });
        resolve(false);
      }
    }, timeout);
  });
};

/**
 * Captures all stdout and stderr output from a process
 */
export const captureProcessOutput = (devProcess: ChildProcess) => {
  const output = { stdout: "", stderr: "" };

  devProcess.stdout?.on("data", (data: any) => {
    output.stdout += data.toString();
  });

  devProcess.stderr?.on("data", (data: any) => {
    output.stderr += data.toString();
  });

  return output;
};
