import { ChildProcess } from "child_process";
import { promisify } from "util";
import { TIMEOUTS } from "../constants";

const execAsync = promisify(require("child_process").exec);
const setTimeoutAsync = (ms: number) =>
  new Promise<void>((resolve) => global.setTimeout(resolve, ms));

/**
 * Stops a development process with graceful shutdown and forced termination fallback
 */
export const stopDevProcess = async (
  devProcess: ChildProcess | null,
): Promise<void> => {
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
  devProcess: ChildProcess,
  timeout: number,
  startupMessage: string,
  serverUrl: string,
): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    let serverStarted = false;
    let timeoutId: ReturnType<typeof global.setTimeout>;
    let pingInterval: ReturnType<typeof global.setInterval> | null = null;

    devProcess.stdout?.on("data", async (data) => {
      const output = data.toString();
      if (!output.match(/^\n[⢹⢺⢼⣸⣇⡧⡗⡏] Starting local infrastructure$/)) {
        console.log("Dev server output:", output);
      }

      if (!serverStarted && output.includes(startupMessage)) {
        serverStarted = true;
        if (pingInterval) clearInterval(pingInterval);
        resolve();
      }
    });

    devProcess.stderr?.on("data", (data) => {
      console.error("Dev server stderr:", data.toString());
    });

    devProcess.on("exit", (code) => {
      console.log(`Dev process exited with code ${code}`);
      if (!serverStarted) {
        reject(new Error(`Dev process exited with code ${code}`));
      }
    });

    // Fallback readiness probe: HTTP ping
    pingInterval = setInterval(async () => {
      if (serverStarted) {
        if (pingInterval) clearInterval(pingInterval);
        return;
      }
      try {
        const res = await fetch(`${serverUrl}/ingest`);
        if (res.ok || [400, 404, 405].includes(res.status)) {
          serverStarted = true;
          if (pingInterval) clearInterval(pingInterval);
          clearTimeout(timeoutId);
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
      if (pingInterval) clearInterval(pingInterval);
      reject(new Error("Dev server timeout"));
    }, timeout);
  });
};

/**
 * Kills any remaining moose-cli processes
 */
export const killRemainingProcesses = async (): Promise<void> => {
  try {
    await execAsync("pkill -f moose-cli || true");
    console.log("Killed any remaining moose-cli processes");
  } catch (error) {
    console.warn("Error killing remaining processes:", error);
  }
};
