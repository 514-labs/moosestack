import { log as logger, Context } from "@temporalio/activity";
import { AsyncLocalStorage } from "async_hooks";
import * as util from "util";
import { isCancellation } from "@temporalio/workflow";
import { Task, Workflow } from "../dmv2";
import { getWorkflows, getTaskForWorkflow } from "../dmv2/internal";
import { jsonDateReviver } from "../utilities/json";

// AsyncLocalStorage to track task context without mutating globals
const taskContextStorage = new AsyncLocalStorage<{ taskName: string }>();

// Safe serialization that handles circular references and BigInt
function safeStringify(arg: any): string {
  if (typeof arg === "object" && arg !== null) {
    try {
      return JSON.stringify(arg);
    } catch (e) {
      // Fall back to util.inspect for circular references or BigInt
      return util.inspect(arg, { depth: 2, breakLength: Infinity });
    }
  }
  return String(arg);
}

// Structured console wrapper that uses AsyncLocalStorage
function createStructuredConsoleWrapper(
  originalMethod: (...args: any[]) => void,
  level: string,
) {
  return (...args: any[]) => {
    const context = taskContextStorage.getStore();
    if (context) {
      // We're in a task context - emit structured log
      const message = args.map((arg) => safeStringify(arg)).join(" ");
      process.stderr.write(
        JSON.stringify({
          __moose_structured_log__: true,
          level,
          message,
          task_name: context.taskName,
          timestamp: new Date().toISOString(),
        }) + "\n",
      );
    } else {
      // Not in task context - use original console
      originalMethod(...args);
    }
  };
}

// Wrap console methods once at module load
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};

console.log = createStructuredConsoleWrapper(originalConsole.log, "info");
console.info = createStructuredConsoleWrapper(originalConsole.info, "info");
console.warn = createStructuredConsoleWrapper(originalConsole.warn, "warn");
console.error = createStructuredConsoleWrapper(originalConsole.error, "error");
console.debug = createStructuredConsoleWrapper(originalConsole.debug, "debug");

export interface ScriptExecutionInput {
  scriptPath: string;
  inputData?: any;
}

export const activities = {
  async hasDmv2Workflow(name: string): Promise<boolean> {
    try {
      const workflows = await getWorkflows();
      const hasWorkflow = workflows.has(name);
      logger.info(`Found workflow:: ${hasWorkflow}`);
      return hasWorkflow;
    } catch (error) {
      logger.error(`Failed to check if workflow ${name} exists: ${error}`);
      return false;
    }
  },

  async getDmv2Workflow(name: string): Promise<Workflow> {
    try {
      logger.info(`Getting workflow ${name}`);

      const workflows = await getWorkflows();

      if (workflows.has(name)) {
        logger.info(`Workflow ${name} found`);
        return workflows.get(name)!;
      } else {
        const errorData = {
          error: "Workflow not found",
          details: `Workflow ${name} not found`,
          stack: undefined,
        };
        const errorMsg = JSON.stringify(errorData);
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }
    } catch (error) {
      const errorData = {
        error: "Failed to get workflow",
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };
      const errorMsg = JSON.stringify(errorData);
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  },

  async getTaskForWorkflow(
    workflowName: string,
    taskName: string,
  ): Promise<Task<any, any>> {
    try {
      logger.info(`Getting task ${taskName} from workflow ${workflowName}`);
      const task = await getTaskForWorkflow(workflowName, taskName);
      logger.info(`Task ${taskName} found in workflow ${workflowName}`);
      return task;
    } catch (error) {
      const errorData = {
        error: "Failed to get task",
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };
      const errorMsg = JSON.stringify(errorData);
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  },

  async executeDmv2Task(
    workflow: Workflow,
    task: Task<any, any>,
    inputData: any,
  ): Promise<any[]> {
    // Get context for heartbeat (required for cancellation detection)
    const context = Context.current();
    const taskState = {};

    // Periodic heartbeat is required for cancellation detection
    // https://docs.temporal.io/develop/typescript/cancellation#cancel-an-activity
    // - Temporal activities can only receive cancellation if they send heartbeats
    // - Heartbeats are the communication channel between activity and Temporal server
    // - Server sends cancellation signals back in heartbeat responses
    // - Without heartbeats, context.cancelled will never resolve and cancellation is impossible
    let heartbeatInterval: NodeJS.Timeout | null = null;
    const startPeriodicHeartbeat = () => {
      heartbeatInterval = setInterval(() => {
        context.heartbeat(`Task ${task.name} in progress`);
      }, 5000);
    };
    const stopPeriodicHeartbeat = () => {
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    };

    try {
      logger.info(
        `Task ${task.name} received input: ${JSON.stringify(inputData)}`,
      );

      // Send initial heartbeat to enable cancellation detection
      context.heartbeat(`Starting task: ${task.name}`);

      // Data between temporal workflow & activities are serialized so we
      // have to get it again to access the user's run function
      const fullTask = await getTaskForWorkflow(workflow.name, task.name);

      // Revive any JSON serialized dates in the input data
      const revivedInputData =
        inputData ?
          JSON.parse(JSON.stringify(inputData), jsonDateReviver)
        : inputData;

      try {
        startPeriodicHeartbeat();

        // Get task identifier for context
        const taskIdentifier = `${workflow.name}/${task.name}`;

        // Use AsyncLocalStorage to set context for this task execution
        // This avoids race conditions from concurrent task executions
        const result = await taskContextStorage.run(
          { taskName: taskIdentifier },
          async () => {
            // Race user code against cancellation detection
            // - context.cancelled Promise rejects when server signals cancellation via heartbeat response
            // - This allows immediate cancellation detection rather than waiting for user code to finish
            // - If cancellation happens first, we catch it below and call onCancel cleanup
            return await Promise.race([
              fullTask.config.run({ state: taskState, input: revivedInputData }),
              context.cancelled,
            ]);
          },
        );
        return result;
      } catch (error) {
        if (isCancellation(error)) {
          logger.info(
            `Task ${task.name} cancelled, calling onCancel handler if it exists`,
          );
          if (fullTask.config.onCancel) {
            await fullTask.config.onCancel({
              state: taskState,
              input: revivedInputData,
            });
          }
          return [];
        } else {
          throw error;
        }
      } finally {
        stopPeriodicHeartbeat();
      }
    } catch (error) {
      const errorData = {
        error: "Task execution failed",
        details: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };
      const errorMsg = JSON.stringify(errorData);
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  },
};

// Helper function to create activity for a specific script
export function createActivityForScript(scriptName: string) {
  return {
    [scriptName]: activities.executeDmv2Task,
  };
}
