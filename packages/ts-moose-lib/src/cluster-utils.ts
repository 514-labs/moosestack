import cluster from "node:cluster";
import { availableParallelism } from "node:os";
import { exit } from "node:process";
import { Worker } from "node:cluster";

const DEFAULT_MAX_CPU_USAGE_RATIO = 0.7;
// Time to restart the worker when it exits unexpectedly
// This value is not too high to avoid the worker to be stuck in a bad state
// but also not too low to avoid restarting the worker too often
const RESTART_TIME_MS = 10000;
const SIGTERM = "SIGTERM";
const SIGINT = "SIGINT";
const SHUTDOWN_WORKERS_INTERVAL = 500;

/**
 * Manages a cluster of worker processes, handling their lifecycle including startup,
 * shutdown, and error handling.
 *
 * @typeParam C - The type of output produced during worker startup
 */
export class Cluster<C> {
  // Tracks if shutdown is currently in progress
  private shutdownInProgress: boolean = false;
  // Tracks if workers exited cleanly during shutdown
  private hasCleanWorkerExit: boolean = true;

  // String identifying if this is primary or worker process
  private processStr = `${cluster.isPrimary ? "primary" : "worker"} process ${process.pid}`;

  // Functions for starting and stopping workers
  private workerStart: (w: Worker, paralelism: number) => Promise<C>;
  private workerStop: (c: C) => Promise<void>;

  // Result from starting worker, needed for cleanup
  private startOutput: C | undefined;
  private maxCpuUsageRatio: number;
  private usedCpuCount: number;

  /**
   * Creates a new cluster manager instance.
   *
   * @param options - Configuration options for the cluster
   * @param options.workerStart - Async function to execute when starting a worker
   * @param options.workerStop - Async function to execute when stopping a worker
   * @param options.maxCpuUsageRatio - Maximum ratio of CPU cores to utilize (0-1)
   * @param options.maxWorkerCount - Maximum number of workers to spawn
   * @throws {Error} If maxCpuUsageRatio is not between 0 and 1
   */
  constructor(options: {
    workerStart: (w: Worker, paralelism: number) => Promise<C>;
    workerStop: (c: C) => Promise<void>;
    maxCpuUsageRatio?: number;
    maxWorkerCount?: number;
  }) {
    this.workerStart = options.workerStart;
    this.workerStop = options.workerStop;
    if (
      options.maxCpuUsageRatio &&
      (options.maxCpuUsageRatio > 1 || options.maxCpuUsageRatio < 0)
    ) {
      throw new Error("maxCpuUsageRatio must be between 0 and 1");
    }
    this.maxCpuUsageRatio =
      options.maxCpuUsageRatio || DEFAULT_MAX_CPU_USAGE_RATIO;
    this.usedCpuCount = this.computeCPUUsageCount(
      this.maxCpuUsageRatio,
      options.maxWorkerCount,
    );
  }

  /**
   * Calculates the number of CPU cores to utilize based on available parallelism and constraints.
   *
   * @param cpuUsageRatio - Ratio of CPU cores to use (0-1)
   * @param maxWorkerCount - Optional maximum number of workers
   * @returns The number of CPU cores to utilize
   */
  computeCPUUsageCount(cpuUsageRatio: number, maxWorkerCount?: number) {
    const cpuCount = availableParallelism();
    const maxWorkers = maxWorkerCount || cpuCount;
    return Math.min(
      maxWorkers,
      Math.max(1, Math.floor(cpuCount * cpuUsageRatio)),
    );
  }

  /**
   * Initializes the cluster by spawning worker processes and setting up signal handlers.
   * For the primary process, spawns workers and monitors parent process.
   * For worker processes, executes the worker startup function.
   *
   * @throws {Error} If worker is undefined in worker process
   */
  async start() {
    process.on(SIGTERM, this.gracefulClusterShutdown(SIGTERM));
    process.on(SIGINT, this.gracefulClusterShutdown(SIGINT));

    if (cluster.isPrimary) {
      const parentPid = process.ppid;

      setInterval(() => {
        try {
          process.kill(parentPid, 0);
        } catch (e) {
          console.log("Parent process has exited.");
          this.gracefulClusterShutdown(SIGTERM)();
        }
      }, 1000);

      await this.bootWorkers(this.usedCpuCount);
    } else {
      if (!cluster.worker) {
        throw new Error(
          "Worker is not defined, it should be defined in worker process",
        );
      }

      this.startOutput = await this.workerStart(
        cluster.worker,
        this.usedCpuCount,
      );
    }
  }

  /**
   * Spawns worker processes and configures their lifecycle event handlers.
   * Handles worker online, exit and disconnect events.
   * Automatically restarts failed workers during normal operation.
   *
   * @param numWorkers - Number of worker processes to spawn
   */
  bootWorkers = async (numWorkers: number) => {
    console.info(`Setting ${numWorkers} workers...`);

    for (let i = 0; i < numWorkers; i++) {
      cluster.fork();
    }

    cluster.on("online", (worker) => {
      console.info(`worker process ${worker.process.pid} is online`);
    });

    cluster.on("exit", (worker, code, signal) => {
      console.info(
        `worker ${worker.process.pid} exited with code ${code} and signal ${signal}`,
      );

      if (!this.shutdownInProgress) {
        setTimeout(() => cluster.fork(), RESTART_TIME_MS);
      }

      if (this.shutdownInProgress && code != 0) {
        this.hasCleanWorkerExit = false;
      }
    });

    cluster.on("disconnect", (worker) => {
      console.info(`worker process ${worker.process.pid} has disconnected`);
    });
  };

  /**
   * Creates a handler function for graceful shutdown on receipt of a signal.
   * Ensures only one shutdown can occur at a time.
   * Handles shutdown differently for primary and worker processes.
   *
   * @param signal - The signal triggering the shutdown (e.g. SIGTERM)
   * @returns An async function that performs the shutdown
   */
  gracefulClusterShutdown = (signal: NodeJS.Signals) => async () => {
    if (this.shutdownInProgress) {
      return;
    }

    this.shutdownInProgress = true;
    this.hasCleanWorkerExit = true;

    console.info(
      `Got ${signal} on ${this.processStr}. Graceful shutdown start at ${new Date().toISOString()}`,
    );

    try {
      if (cluster.isPrimary) {
        await this.shutdownWorkers(signal);
        console.info(`${this.processStr} - worker shutdown successful`);
        exit(0);
      } else {
        // Only attempt to stop if the worker has finished starting
        if (this.startOutput) {
          await this.workerStop(this.startOutput);
        } else {
          console.info(
            `${this.processStr} - shutdown before worker fully started`,
          );
        }
        console.info(`${this.processStr} shutdown successful`);
        this.hasCleanWorkerExit ? exit(0) : exit(1);
      }
    } catch (e) {
      console.error(`${this.processStr} - shutdown failed`, e);
      exit(1);
    }
  };

  /**
   * Gracefully terminates all worker processes.
   * Monitors workers until they all exit or timeout occurs.
   * Only relevant for the primary process.
   *
   * @param signal - The signal to send to worker processes
   * @returns A promise that resolves when all workers have terminated
   */
  shutdownWorkers = (signal: NodeJS.Signals) => {
    return new Promise<void>((resolve, reject) => {
      if (!cluster.isPrimary) {
        return resolve();
      }

      if (!cluster.workers) {
        return resolve();
      }

      const workerIds = Object.keys(cluster.workers);
      if (workerIds.length == 0) {
        return resolve();
      }

      let workersAlive = 0;
      let funcRun = 0;

      const cleanWorkers = () => {
        ++funcRun;
        workersAlive = 0;

        Object.values(cluster.workers || {})
          .filter((worker) => !!worker)
          .forEach((worker) => {
            if (worker && !worker.isDead()) {
              ++workersAlive;
              if (funcRun == 1) {
                worker.kill(signal);
              }
            }
          });

        console.info(workersAlive + " workers alive");
        if (workersAlive == 0) {
          clearInterval(interval);
          return resolve();
        }
      };

      const interval = setInterval(cleanWorkers, SHUTDOWN_WORKERS_INTERVAL);
    });
  };
}
