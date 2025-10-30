import { TIMEOUTS } from "../constants";

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
 * Stops a development process with graceful shutdown and forced termination fallback
 */
export const stopDevProcess = async (devProcess: any): Promise<void> => {
  if (devProcess && !devProcess.killed) {
    console.log("Stopping dev process...");
    devProcess.kill("SIGINT");

    // Wait for graceful shutdown with timeout
    const gracefulShutdownPromise = new Promise<void>((resolve) => {
      devProcess!.on("exit", () => {
        console.log("Dev process has exited gracefully");
        resolve();
      });
    });

    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.log("Dev process did not exit gracefully, forcing kill...");
        if (!devProcess!.killed) {
          devProcess!.kill("SIGKILL");
        }
        resolve();
      }, TIMEOUTS.PROCESS_TERMINATION_MS);
    });

    // Race between graceful shutdown and timeout
    await Promise.race([gracefulShutdownPromise, timeoutPromise]);

    // Give a brief moment for cleanup after forced kill
    if (!devProcess.killed) {
      await setTimeoutAsync(TIMEOUTS.BRIEF_CLEANUP_WAIT_MS);
    }
  }
};

/**
 * Waits for the development server to start by monitoring stdout and HTTP pings
 */
export const waitForServerStart = async (
  devProcess: any,
  timeout: number,
  startupMessage: string,
  serverUrl: string,
): Promise<void> => {
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

    const onStdout = async (data: any) => {
      const output = data.toString();
      if (!output.match(/^\n[⢹⢺⢼⣸⣇⡧⡗⡏] Starting local infrastructure$/)) {
        console.log("Dev server output:", output);
      }

      if (!serverStarted && output.includes(startupMessage)) {
        serverStarted = true;
        cleanup();
        resolve();
      }
    };

    const onStderr = (data: any) => {
      console.error("Dev server stderr:", data.toString());
    };

    const onExit = (code: number | null) => {
      console.log(`Dev process exited with code ${code}`);
      if (!serverStarted) {
        cleanup();
        reject(new Error(`Dev process exited with code ${code}`));
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
      console.error("Dev server did not start or complete in time");
      devProcess.kill("SIGINT");
      cleanup();
      reject(new Error("Dev server timeout"));
    }, timeout);
  });
};

/**
 * Kills any remaining moose-cli processes
 */
export const killRemainingProcesses = async (): Promise<void> => {
  try {
    await execAsync("pkill -9 -f moose-cli || true", {
      timeout: TIMEOUTS.PROCESS_TERMINATION_MS,
      killSignal: "SIGKILL",
      windowsHide: true,
    });
    console.log("Killed any remaining moose-cli processes");
  } catch (error) {
    console.warn("Error killing remaining processes:", error);
  }
};

/**
 * Wait for streaming functions to start by watching the moose CLI log file.
 */
export const waitForStreamingFunctions = async (
  timeoutMs: number = 120000,
): Promise<void> => {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");

  // Log file is named with today's date in LOCAL time: YYYY-MM-DD-cli.log
  // fern::DateBased uses local time, not UTC, so we must match that
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const dateStr = `${year}-${month}-${day}`; // Local time YYYY-MM-DD
  const logFilePath = path.join(os.homedir(), ".moose", `${dateStr}-cli.log`);
  console.log(
    `Waiting for streaming functions to start (watching ${logFilePath})...`,
  );

  return new Promise<void>((resolve, reject) => {
    let checkInterval: any = null;
    let watcher: any = null;

    const cleanup = () => {
      if (checkInterval) {
        clearInterval(checkInterval);
        checkInterval = null;
      }
      if (watcher) {
        clearInterval(watcher);
        watcher = null;
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `Streaming functions did not start within ${timeoutMs / 1000}s (log: ${logFilePath})`,
        ),
      );
    }, timeoutMs);

    // Standardized log message emitted by both Python and TypeScript streaming functions
    // when they're fully initialized and ready to process messages
    const readyPattern = /Streaming function started/i;
    let streamingFunctionsReady = 0;

    // Check if log file exists
    if (!fs.existsSync(logFilePath)) {
      console.log(`Log file not found yet, waiting for it to be created...`);
    }

    // Watch for file creation and changes
    checkInterval = setInterval(() => {
      if (!fs.existsSync(logFilePath)) {
        return;
      }

      // File exists, start watching it
      clearInterval(checkInterval);

      let lastSize = 0;

      const checkLogFile = () => {
        try {
          const stats = fs.statSync(logFilePath);
          if (stats.size > lastSize) {
            // Read only the new content
            const stream = fs.createReadStream(logFilePath, {
              start: lastSize,
              end: stats.size,
            });

            let newContent = "";
            stream.on("data", (chunk: Buffer) => {
              newContent += chunk.toString();
            });

            stream.on("end", () => {
              lastSize = stats.size;

              // Check for the standardized "ready" message
              const readyMatches = newContent.match(
                new RegExp(readyPattern, "gi"),
              );

              if (readyMatches) {
                streamingFunctionsReady += readyMatches.length;
                console.log(
                  `Streaming function ready (${streamingFunctionsReady} total)`,
                );
              }

              // Wait for at least one streaming function to be ready
              // Then give it a bit more time for consumer group to stabilize
              if (streamingFunctionsReady > 0) {
                console.log(
                  "Streaming functions initialized, waiting for consumer group to stabilize...",
                );
                setTimeout(() => {
                  clearTimeout(timeout);
                  cleanup();
                  console.log("Streaming functions started");
                  resolve();
                }, 3000); // 3 second grace period for consumer group join
              }
            });
          }
        } catch (error) {
          // File might not exist yet or be locked, continue waiting
        }
      };

      // Poll the file every 500ms
      watcher = setInterval(checkLogFile, 500);
    }, 200); // Check for file existence every 200ms
  });
};
