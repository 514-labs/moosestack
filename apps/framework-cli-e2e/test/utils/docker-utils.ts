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

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(timeoutMessage)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
};

/**
 * Cleans up Docker resources with timeouts to prevent hanging
 */
export const cleanupDocker = async (
  projectDir: string,
  appName: string,
): Promise<void> => {
  console.log(`Cleaning up Docker resources for ${appName}...`);
  try {
    // Stop containers and remove volumes with timeout
    await withTimeout(
      execAsync(
        `docker compose -f .moose/docker-compose.yml -p ${appName} down -v`,
        { cwd: projectDir },
      ),
      TIMEOUTS.DOCKER_COMPOSE_DOWN_MS,
      "Docker compose down timeout",
    );

    // Additional cleanup for any orphaned volumes with timeout
    const { stdout: volumeList } = await withTimeout(
      execAsync(
        `docker volume ls --filter name=${appName}_ --format '{{.Name}}'`,
      ),
      TIMEOUTS.DOCKER_VOLUME_LIST_MS,
      "Docker volume list timeout",
    );

    if (volumeList.trim()) {
      const volumes = volumeList.split("\n").filter(Boolean);
      for (const volume of volumes) {
        console.log(`Removing volume: ${volume}`);
        try {
          await withTimeout(
            execAsync(`docker volume rm -f ${volume}`),
            TIMEOUTS.DOCKER_VOLUME_REMOVE_MS,
            "Volume removal timeout",
          );
        } catch (volumeError) {
          console.warn(`Failed to remove volume ${volume}:`, volumeError);
        }
      }
    }

    console.log("Docker cleanup completed successfully");
  } catch (error) {
    console.error("Error during Docker cleanup:", error);
    // Don't throw - we want cleanup to continue even if Docker cleanup fails
  }
};

/**
 * Performs global Docker system cleanup
 */
export const globalDockerCleanup = async (): Promise<void> => {
  try {
    await withTimeout(
      execAsync("docker system prune -f --volumes || true"),
      TIMEOUTS.DOCKER_COMPOSE_DOWN_MS,
      "Docker system prune timeout",
    );
    console.log("Cleaned up Docker resources");
  } catch (error) {
    console.warn("Error during global Docker cleanup:", error);
  }
};
