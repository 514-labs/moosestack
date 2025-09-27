declare const require: any;
const { promisify } = require("util");
import { TIMEOUTS } from "../constants";

const execAsync = promisify(require("child_process").exec);

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
    await Promise.race([
      execAsync(
        `docker compose -f .moose/docker-compose.yml -p ${appName} down -v`,
        { cwd: projectDir },
      ),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Docker compose down timeout")),
          TIMEOUTS.DOCKER_COMPOSE_DOWN_MS,
        ),
      ),
    ]);

    // Additional cleanup for any orphaned volumes with timeout
    const volumeListPromise = execAsync(
      `docker volume ls --filter name=${appName}_ --format '{{.Name}}'`,
    );
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Docker volume list timeout")),
        TIMEOUTS.DOCKER_VOLUME_LIST_MS,
      ),
    );

    const { stdout: volumeList } = await Promise.race([
      volumeListPromise,
      timeoutPromise,
    ]);

    if (volumeList.trim()) {
      const volumes = volumeList.split("\n").filter(Boolean);
      for (const volume of volumes) {
        console.log(`Removing volume: ${volume}`);
        try {
          await Promise.race([
            execAsync(`docker volume rm -f ${volume}`),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error("Volume removal timeout")),
                TIMEOUTS.DOCKER_VOLUME_REMOVE_MS,
              ),
            ),
          ]);
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
    await Promise.race([
      execAsync("docker system prune -f --volumes || true"),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Docker system prune timeout")),
          TIMEOUTS.DOCKER_SYSTEM_PRUNE_MS,
        ),
      ),
    ]);
    console.log("Cleaned up Docker resources");
  } catch (error) {
    console.warn("Error during global Docker cleanup:", error);
  }
};
