import { TIMEOUTS } from "../constants";
import { logger, type ScopedLogger } from "./logger";

const dockerLogger = logger.scope("utils:docker");

const STALE_E2E_CONTAINER_PREFIXES = [
  "moose-e2e-test-",
  "moosestack-service-moose-e2e-test-",
  "moose-ts-agent-app-",
  "moose-ts-otlp-app-",
  "moose-ts-rls-app-",
  "test-unloaded-ts-",
  "test-unloaded-py-",
  "test-override-app-",
  "ts-dotenv-config-test-",
  "py-dotenv-config-test-",
  "incr-test-app-",
  "query-cmd-test-",
  "ts-migrate-",
] as const;

export interface DockerOptions {
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

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isStaleE2eContainer(name: string): boolean {
  return STALE_E2E_CONTAINER_PREFIXES.some((prefix) => name.startsWith(prefix));
}

async function removeStaleTestContainers(log: ScopedLogger): Promise<void> {
  const { stdout } = await withTimeout(
    execAsync("docker ps -a --format '{{.Names}}'"),
    TIMEOUTS.DOCKER_VOLUME_LIST_MS,
    "Docker container list timeout",
  );

  const staleContainers = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isStaleE2eContainer);

  if (staleContainers.length === 0) {
    return;
  }

  log.debug("Removing stale E2E containers", { staleContainers });
  await withTimeout(
    execAsync(
      `docker rm -f ${staleContainers.map(shellEscape).join(" ")} || true`,
    ),
    TIMEOUTS.DOCKER_COMPOSE_DOWN_MS,
    "Stale Docker container cleanup timeout",
  );
}

/**
 * Cleans up Docker resources with timeouts to prevent hanging
 */
export const cleanupDocker = async (
  projectDir: string,
  appName: string,
  options: DockerOptions = {},
): Promise<void> => {
  const log = options.logger ?? dockerLogger;
  log.debug("Cleaning up Docker resources", { appName });

  try {
    // Stop containers and remove volumes with timeout
    await withTimeout(
      execAsync(
        `docker compose -f .moose/docker-compose.yml -p ${appName} down -v`,
        {
          cwd: projectDir,
        },
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
        log.debug("Removing volume", { volume });
        try {
          await withTimeout(
            execAsync(`docker volume rm -f ${volume}`),
            TIMEOUTS.DOCKER_VOLUME_REMOVE_MS,
            "Volume removal timeout",
          );
        } catch (volumeError) {
          log.warn(`Failed to remove volume ${volume}`, volumeError);
        }
      }
    }

    log.info("✓ Docker cleanup completed successfully");
  } catch (error) {
    log.error("Error during Docker cleanup", error);
    // Don't throw - we want cleanup to continue even if Docker cleanup fails
  }
};

/**
 * Performs global Docker system cleanup
 */
export const globalDockerCleanup = async (
  options: DockerOptions = {},
): Promise<void> => {
  const log = options.logger ?? dockerLogger;

  try {
    log.debug("Running global Docker cleanup");
    await removeStaleTestContainers(log);
    await withTimeout(
      execAsync("docker system prune -f --volumes || true"),
      TIMEOUTS.DOCKER_COMPOSE_DOWN_MS,
      "Docker system prune timeout",
    );
    log.info("✓ Cleaned up Docker resources");
  } catch (error) {
    log.warn("Error during global Docker cleanup", error);
  }
};
