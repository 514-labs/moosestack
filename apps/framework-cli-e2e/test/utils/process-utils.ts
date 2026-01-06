import { TIMEOUTS, SERVER_CONFIG } from "../constants";
import { withRetries } from "./retry-utils";
import { logger, ScopedLogger } from "./logger";
import { ChildProcess } from "child_process";

const processLogger = logger.scope("utils:process");

export interface ProcessOptions {
  logger?: ScopedLogger;
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
 * Kills any remaining moose-cli processes
 */
export const killRemainingProcesses = async (
  options: ProcessOptions = {},
): Promise<void> => {
  const log = options.logger ?? processLogger;

  try {
    await execAsync("pkill -9 -f moose-cli || true", {
      timeout: TIMEOUTS.PROCESS_TERMINATION_MS,
      killSignal: "SIGKILL",
      windowsHide: true,
    });
    log.debug("Killed any remaining moose-cli processes");

    await execAsync(
      "pkill -9 -f 'streaming_function_runner|python_worker_wrapper|consumption.*localhost' || true",
      {
        timeout: TIMEOUTS.PROCESS_TERMINATION_MS,
        killSignal: "SIGKILL",
        windowsHide: true,
      },
    );
    log.debug("Killed any remaining Python processes");
  } catch (error) {
    log.warn("Error killing remaining processes", error);
  }
};

/**
 * Wait for streaming functions to start by checking Redpanda consumer groups.
 *
 * This approach directly verifies that streaming function consumers have:
 * 1. Connected to Kafka/Redpanda
 * 2. Joined their consumer groups
 * 3. Reached a "Stable" state (ready to process messages)
 *
 * Streaming functions create consumer groups with names starting with "flow-".
 * We poll `rpk group list` until we find at least one such group in Stable state.
 */
export const waitForStreamingFunctions = async (
  timeoutMs: number = 120000,
  options: ProcessOptions = {},
): Promise<void> => {
  const log = options.logger ?? processLogger;
  log.debug(
    "Waiting for streaming functions to start (checking Redpanda consumer groups)",
    {
      timeoutMs,
    },
  );

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      // Find the Redpanda container (there's only one per test run)
      const { stdout: containerName } = await execAsync(
        `docker ps --filter "label=com.docker.compose.service=redpanda" --format '{{.Names}}'`,
      );

      if (!containerName.trim()) {
        log.debug("Waiting for Redpanda container to start");
        await setTimeoutAsync(1000);
        continue;
      }

      // Check consumer groups using rpk
      const { stdout: groupList } = await execAsync(
        `docker exec ${containerName.trim()} rpk group list`,
      );

      log.debug("Redpanda consumer groups", { groupList: groupList.trim() });

      // Parse for Stable flow-* groups
      // Expected format: "BROKER  GROUP  STATE"
      // Example: "0  flow-Foo-  Stable"
      const lines = groupList.split("\n").slice(1); // Skip header
      const flowGroups = lines.filter((line) => line.includes("flow-"));
      const stableFlowGroups = flowGroups.filter((line) =>
        line.includes("Stable"),
      );

      // Wait for ALL flow- groups to be stable, not just ANY
      if (
        flowGroups.length > 0 &&
        stableFlowGroups.length === flowGroups.length
      ) {
        log.debug(
          `Found ${stableFlowGroups.length} active streaming function(s)`,
          {
            functions: stableFlowGroups.map((g) => g.trim()),
          },
        );

        // Grace period for consumer group to fully stabilize
        log.debug("Waiting for consumer groups to stabilize");
        await setTimeoutAsync(3000);
        log.debug("✓ Streaming functions ready");
        return;
      }

      log.debug(
        `Waiting for all streaming functions to be stable (${stableFlowGroups.length}/${flowGroups.length} ready)`,
      );
      await setTimeoutAsync(1000);
    } catch (error) {
      // Container might not be ready yet, or rpk command failed
      // Continue polling until timeout
      log.debug("Error checking consumer groups, retrying", {
        error: error instanceof Error ? error.message : String(error),
      });
      await setTimeoutAsync(1000);
    }
  }

  throw new Error(
    `Streaming functions did not reach Stable state within ${timeoutMs / 1000}s`,
  );
};

/**
 * Waits for all infrastructure components to be ready
 * Uses the /ready endpoint which checks Redis, Redpanda, ClickHouse, and Temporal
 */
export const waitForInfrastructureReady = async (
  timeoutMs: number = 60_000,
  options: ProcessOptions = {},
): Promise<void> => {
  const log = options.logger ?? processLogger;
  log.debug("Waiting for all infrastructure to be ready", { timeoutMs });

  await withRetries(
    async () => {
      const response = await fetch(`${SERVER_CONFIG.url}/ready`);
      // /ready returns 200 OK when all services are healthy, 503 otherwise
      if (response.status !== 200) {
        const body = await response.text();
        throw new Error(
          `Infrastructure not ready (${response.status}): ${body}`,
        );
      }
      log.debug("✓ All infrastructure components are ready");
    },
    {
      attempts: Math.floor(timeoutMs / 1000),
      delayMs: 1000,
      backoffFactor: 1,
      logger: log,
      operationName: "Infrastructure readiness check",
    },
  );
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
