import {
  DefaultLogger,
  NativeConnection,
  NativeConnectionOptions,
  Worker,
  bundleWorkflowCode,
} from "@temporalio/worker";
import * as path from "path";
import * as fs from "fs";
import { Workflow } from "../dmv2";
import { getWorkflows } from "../dmv2/internal";
import { createActivityForScript } from "./activity";
import { activities } from "./activity";
import { initializeLogger } from "./logger";

interface TemporalConfig {
  url: string;
  namespace: string;
  clientCert?: string;
  clientKey?: string;
  apiKey?: string;
}

interface ScriptsConfig {
  temporalConfig: TemporalConfig;
}

// Maintain a global set of activity names we've already registered
const ALREADY_REGISTERED = new Set<string>();

function collectActivitiesDmv2(
  logger: DefaultLogger,
  workflows: Map<string, Workflow>,
) {
  logger.info(`<DMV2WF> Collecting tasks from dmv2 workflows`);
  const scriptNames: string[] = [];
  for (const [name, workflow] of workflows.entries()) {
    logger.info(
      `<DMV2WF> Registering dmv2 workflow: ${name} with starting task: ${workflow.config.startingTask.name}`,
    );
    scriptNames.push(`${name}/${workflow.config.startingTask.name}`);
  }
  return scriptNames;
}

/**
 * This looks similar to the client in apis.
 * Temporal SDK uses similar looking connection options & client,
 * but there are different libraries for a worker like this & a client
 * like in the apis.
 */
async function createTemporalConnection(
  logger: DefaultLogger,
  temporalConfig: TemporalConfig,
): Promise<NativeConnection> {
  logger.info(
    `<workflow> Using temporal_url: ${temporalConfig.url} and namespace: ${temporalConfig.namespace}`,
  );

  let connectionOptions: NativeConnectionOptions = {
    address: temporalConfig.url,
  };

  if (temporalConfig.clientCert && temporalConfig.clientKey) {
    logger.info("Using TLS for secure Temporal");
    const cert = await fs.readFileSync(temporalConfig.clientCert);
    const key = await fs.readFileSync(temporalConfig.clientKey);

    connectionOptions.tls = {
      clientCertPair: {
        crt: cert,
        key: key,
      },
    };
  } else if (temporalConfig.apiKey) {
    logger.info(`Using API key for secure Temporal`);
    // URL with API key uses gRPC regional endpoint
    connectionOptions.address = "us-west1.gcp.api.temporal.io:7233";
    connectionOptions.apiKey = temporalConfig.apiKey;
    connectionOptions.tls = {};
    connectionOptions.metadata = {
      "temporal-namespace": temporalConfig.namespace,
    };
  }

  logger.info(
    `<workflow> Connecting to Temporal at ${connectionOptions.address}`,
  );

  const maxRetries = 5;
  const baseDelay = 1000;
  let attempt = 0;

  while (true) {
    try {
      const connection = await NativeConnection.connect(connectionOptions);
      logger.info("<workflow> Connected to Temporal server");
      return connection;
    } catch (err) {
      attempt++;
      logger.error(`<workflow> Connection attempt ${attempt} failed: ${err}`);

      if (attempt >= maxRetries) {
        logger.error(`Failed to connect after ${attempt} attempts`);
        throw err;
      }

      const backoff = baseDelay * Math.pow(2, attempt - 1);
      logger.warn(`<workflow> Retrying connection in ${backoff}ms...`);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
}

async function registerWorkflows(
  logger: DefaultLogger,
  config: ScriptsConfig,
): Promise<Worker | null> {
  logger.info(`Registering workflows`);

  // Collect all TypeScript activities from registered workflows
  const allScriptPaths: string[] = [];
  const dynamicActivities: any[] = [];

  try {
    const workflows = await getWorkflows();
    if (workflows.size > 0) {
      logger.info(`<DMV2WF> Found ${workflows.size} dmv2 workflows`);
      allScriptPaths.push(...collectActivitiesDmv2(logger, workflows));

      if (allScriptPaths.length === 0) {
        logger.info(`<DMV2WF> No tasks found in dmv2 workflows`);
        return null;
      }

      logger.info(
        `<DMV2WF> Found ${allScriptPaths.length} tasks in dmv2 workflows`,
      );

      for (const activityName of allScriptPaths) {
        if (!ALREADY_REGISTERED.has(activityName)) {
          const activity = await createActivityForScript(activityName);
          dynamicActivities.push(activity);
          ALREADY_REGISTERED.add(activityName);
          logger.info(`<DMV2WF> Registered task ${activityName}`);
        }
      }

      if (dynamicActivities.length === 0) {
        logger.info(`<DMV2WF> No dynamic activities found in dmv2 workflows`);
        return null;
      }

      logger.info(
        `<DMV2WF> Found ${dynamicActivities.length} dynamic activities in dmv2 workflows`,
      );
    }

    if (allScriptPaths.length === 0) {
      logger.info(`No workflows found`);
      return null;
    }

    logger.info(`Found ${allScriptPaths.length} workflows`);

    if (dynamicActivities.length === 0) {
      logger.info(`No tasks found`);
      return null;
    }

    logger.info(`Found ${dynamicActivities.length} task(s)`);

    const connection = await createTemporalConnection(
      logger,
      config.temporalConfig,
    );

    // Create a custom logger that suppresses webpack output
    const silentLogger = {
      info: () => {}, // Suppress info logs (webpack output)
      debug: () => {}, // Suppress debug logs
      warn: () => {}, // Suppress warnings if desired
      log: () => {}, // Suppress general logs
      trace: () => {}, // Suppress trace logs
      error: (message: string, meta?: any) => {
        // Keep error logs but forward to the main logger
        logger.error(message, meta);
      },
    };

    // Pre-bundle workflows with silent logger to suppress webpack output
    // https://github.com/temporalio/sdk-typescript/issues/1740
    const workflowBundle = await bundleWorkflowCode({
      workflowsPath: path.resolve(__dirname, "scripts/workflow.js"),
      logger: silentLogger,
    });

    const worker = await Worker.create({
      connection,
      namespace: config.temporalConfig.namespace,
      taskQueue: "typescript-script-queue",
      workflowBundle,
      activities: {
        ...activities,
        ...Object.fromEntries(
          dynamicActivities.map((activity) => [
            Object.keys(activity)[0],
            Object.values(activity)[0],
          ]),
        ),
      },
    });

    return worker;
  } catch (error) {
    logger.error(`Error registering workflows: ${error}`);
    throw error;
  }
}

/**
 * Start a Temporal worker that handles TypeScript script execution workflows.
 */
export async function runScripts(
  config: ScriptsConfig,
): Promise<Worker | null> {
  const logger = initializeLogger();

  // Add process-level uncaught exception handler
  process.on("uncaughtException", (error) => {
    console.error(`[PROCESS] Uncaught Exception: ${error}`);
    process.exit(1);
  });

  const worker = await registerWorkflows(logger, config);

  if (!worker) {
    logger.warn(`No workflows found`);
    process.exit(0);
  }

  let isShuttingDown = false;

  // Handle shutdown signals
  async function handleSignal(signal: string) {
    console.log(`[SHUTDOWN] Received ${signal}`);

    if (isShuttingDown) {
      return;
    }

    isShuttingDown = true;

    try {
      if (!worker) {
        process.exit(0);
      }
      await Promise.race([
        worker.shutdown(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Shutdown timeout")), 3000),
        ),
      ]);
      process.exit(0);
    } catch (error) {
      console.log(`[SHUTDOWN] Error: ${error}`);
      process.exit(1);
    }
  }

  // Register signal handlers immediately
  ["SIGTERM", "SIGINT", "SIGHUP", "SIGQUIT"].forEach((signal) => {
    process.on(signal, () => {
      handleSignal(signal).catch((error) => {
        console.log(`[SHUTDOWN] Error: ${error}`);
        process.exit(1);
      });
    });
  });

  logger.info("Starting TypeScript worker...");
  try {
    await worker.run();
  } catch (error) {
    console.log(`[SHUTDOWN] Error: ${error}`);
    process.exit(1);
  }

  return worker;
}
