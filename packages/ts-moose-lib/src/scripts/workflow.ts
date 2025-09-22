import {
  log as logger,
  ActivityOptions,
  proxyActivities,
  workflowInfo,
  continueAsNew,
  sleep,
} from "@temporalio/workflow";
import { Duration } from "@temporalio/common";
import { Task, Workflow } from "../dmv2";

import { WorkflowState } from "./types";
import { mooseJsonEncode } from "./serialization";

interface WorkflowRequest {
  workflow_name: string;
  execution_mode: "start" | "continue_as_new";
  continue_from_task?: string; // Only for continue_as_new
}

const { getDmv2Workflow, getTaskForWorkflow } = proxyActivities({
  startToCloseTimeout: "1 minutes",
  retry: {
    maximumAttempts: 1,
  },
});

export async function ScriptWorkflow(
  request: WorkflowRequest,
  inputData?: any,
): Promise<any[]> {
  const state: WorkflowState = {
    completedSteps: [],
    currentStep: null,
    failedStep: null,
    scriptPath: null,
    inputData: null,
  };

  const results: any[] = [];
  const workflowName = request.workflow_name;
  let currentData = inputData?.data || inputData || {};

  logger.info(
    `Starting workflow: ${workflowName} (mode: ${request.execution_mode}) with data: ${JSON.stringify(currentData)}`,
  );

  try {
    currentData = JSON.parse(mooseJsonEncode(currentData));
    const workflow = await getDmv2Workflow(workflowName);
    const task =
      request.execution_mode === "start" ?
        workflow.config.startingTask
      : await getTaskForWorkflow(workflowName, request.continue_from_task!);
    const result = await handleDmv2Task(workflow, task, currentData);
    results.push(...result);

    return results;
  } catch (error) {
    state.failedStep = workflowName;
    throw error;
  }
}

async function handleDmv2Task(
  workflow: Workflow,
  task: Task<any, any>,
  inputData: any,
): Promise<any[]> {
  // Handle timeout configuration
  const configTimeout = task.config.timeout;
  let taskTimeout: Duration | undefined;

  if (!configTimeout) {
    taskTimeout = "1h";
  } else if (configTimeout === "never") {
    taskTimeout = undefined;
  } else {
    taskTimeout = configTimeout as Duration;
  }

  const taskRetries = task.config.retries ?? 3;

  const timeoutMessage =
    taskTimeout ? `with timeout ${taskTimeout}` : "with no timeout (unlimited)";
  logger.info(
    `Handling task ${task.name} ${timeoutMessage} and retries ${taskRetries}`,
  );

  const activityOptions: ActivityOptions = {
    heartbeatTimeout: "10s",
    retry: {
      maximumAttempts: taskRetries,
    },
  };

  // Temporal requires either startToCloseTimeout OR scheduleToCloseTimeout to be set
  // For unlimited timeout (timeout = "none"), we use scheduleToCloseTimeout with a very large value
  // For normal timeouts, we use startToCloseTimeout for single execution timeout
  if (taskTimeout) {
    // Normal timeout - limit each individual execution attempt
    activityOptions.startToCloseTimeout = taskTimeout;
  } else {
    // Unlimited timeout - set scheduleToCloseTimeout to a very large value (10 years)
    // This satisfies Temporal's requirement while effectively allowing unlimited execution
    activityOptions.scheduleToCloseTimeout = "87600h"; // 10 years
  }

  const { executeDmv2Task } = proxyActivities(activityOptions);

  let taskCompleted = false;

  const monitorTask = async () => {
    logger.info(`Monitor task starting for ${task.name}`);
    while (!taskCompleted) {
      const info = workflowInfo();

      // Continue-as-new only when suggested by Temporal
      if (info.continueAsNewSuggested) {
        logger.info(`ContinueAsNew suggested by Temporal`);
        return await continueAsNew({
          workflow_name: workflow.name,
          execution_mode: "continue_as_new" as const,
          continue_from_task: task.name,
        });
      }

      await sleep(100);
    }
    logger.info(`Monitor task exiting because main task completed`);
  };

  const result = await Promise.race([
    executeDmv2Task(workflow, task, inputData)
      .then((taskResult) => {
        return {
          type: "task_completed" as const,
          data: taskResult,
        };
      })
      .finally(() => {
        taskCompleted = true;
      }),
    monitorTask().then(() => {
      return { type: "continue_as_new" as const, data: undefined };
    }),
  ]);

  if (result.type !== "task_completed") {
    return [];
  }

  const results = [result.data];
  if (!task.config.onComplete?.length) {
    return results;
  }

  for (const childTask of task.config.onComplete) {
    const childResult = await handleDmv2Task(workflow, childTask, result.data);
    results.push(...childResult);
  }

  // Check if this is an ETL extract task that needs to loop
  // ETL extract tasks end with "_extract" and return BatchResult with hasMore
  if (
    task.name.endsWith("_extract") &&
    result &&
    typeof result === "object" &&
    result.data &&
    typeof result.data === "object" &&
    "hasMore" in result.data &&
    (result.data as any).hasMore === true
  ) {
    logger.info(`Extract task ${task.name} has more data, restarting chain...`);

    // Recursively call the extract task again to get the next batch
    const nextBatchResults = await handleDmv2Task(workflow, task, null);
    results.push(...nextBatchResults);
  }

  return results;
}
