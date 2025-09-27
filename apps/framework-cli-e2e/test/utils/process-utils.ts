declare const require: any;
type ChildProcess = any;
const { exec: execCb } = require("child_process");
const { promisify } = require("util");
import { TIMEOUTS } from "../constants";

const execAsync = promisify(execCb);
const setTimeoutAsync = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

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
      devProcess!.once("exit", () => {
        console.log("Dev process has exited gracefully");
        resolve();
      });
    });

    let killTimeout: any;
    const timeoutPromise = new Promise<void>((resolve) => {
      killTimeout = setTimeout(() => {
        console.log("Dev process did not exit gracefully, forcing kill...");
        if (!devProcess!.killed) {
          devProcess!.kill("SIGKILL");
        }
        resolve();
      }, TIMEOUTS.PROCESS_TERMINATION_MS);
    });

    // Race between graceful shutdown and timeout
    await Promise.race([gracefulShutdownPromise, timeoutPromise]);
    if (killTimeout) clearTimeout(killTimeout);

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
    let timeoutId: any | undefined;
    let pingInterval: any | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      if (pingInterval) {
        clearInterval(pingInterval);
        pingInterval = null;
      }
      try { devProcess.stdout?.off?.("data", onStdout); } catch (_) {}
      try { devProcess.stderr?.off?.("data", onStderr); } catch (_) {}
      try { devProcess.off?.("exit", onExit); } catch (_) {}
    };

    const onStdout = async (data: unknown) => {
      const output = String(data);
      if (!output.match(/^\n[⢹⢺⢼⣸⣇⡧⡗⡏] Starting local infrastructure$/)) {
        console.log("Dev server output:", output);
      }

      if (!serverStarted && output.includes(startupMessage)) {
        serverStarted = true;
        cleanup();
        resolve();
      }
    };
    const onStderr = (data: unknown) => {
      console.error("Dev server stderr:", String(data));
    };
    const onExit = (code: number | null) => {
      console.log(`Dev process exited with code ${code}`);
      if (!serverStarted) {
        cleanup();
        reject(new Error(`Dev process exited with code ${code}`));
      }
    };

    devProcess.stdout?.on?.("data", onStdout);
    devProcess.stderr?.on?.("data", onStderr);
    devProcess.on?.("exit", onExit);

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
    await Promise.race([
      execAsync("pkill -9 -f moose-cli || true"),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("pkill timeout")),
          TIMEOUTS.PROCESS_KILL_MS,
        ),
      ),
    ]);
    console.log("Killed any remaining moose-cli processes (or none were running)");
  } catch (error) {
    console.warn("Error killing remaining processes:", error);
  }
};
