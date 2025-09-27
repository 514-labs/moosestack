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
