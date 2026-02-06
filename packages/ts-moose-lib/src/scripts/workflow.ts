import {
  log as logger,
  ActivityOptions,
  proxyActivities,
  workflowInfo,
  continueAsNew,
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

const { getWorkflowByName, getTaskForWorkflow } = proxyActivities({
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
  };

  const results: any[] = [];
  const workflowName = request.workflow_name;
  let currentData = inputData?.data || inputData || {};

  logger.info(
    `Starting workflow: ${workflowName} (mode: ${request.execution_mode}) with data: ${JSON.stringify(currentData)}`,
  );

  try {
    currentData = JSON.parse(mooseJsonEncode(currentData));
    const workflow = await getWorkflowByName(workflowName);
    const task =
      request.execution_mode === "start" ?
        workflow.config.startingTask
      : await getTaskForWorkflow(workflowName, request.continue_from_task!);
    const result = await handleTask(workflow, task, currentData);
    results.push(...result);

    return results;
  } catch (error) {
    state.failedStep = workflowName;
    throw error;
  }
}

async function handleTask(
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
  // Temporal's maximumAttempts = total attempts (initial + retries)
  // User-facing "retries" = number of retries after initial failure
  const maxAttempts = taskRetries + 1;

  const timeoutMessage =
    taskTimeout ? `with timeout ${taskTimeout}` : "with no timeout (unlimited)";
  logger.info(
    `Handling task ${task.name} ${timeoutMessage} and retries ${taskRetries}`,
  );

  const activityOptions: ActivityOptions = {
    heartbeatTimeout: "10s",
    retry: {
      maximumAttempts: maxAttempts,
    },
  };

  // Temporal requires either startToCloseTimeout OR scheduleToCloseTimeout to be set
  // For unlimited timeout (timeout = "never"), we use scheduleToCloseTimeout with a very large value
  // For normal timeouts, we use startToCloseTimeout for single execution timeout
  if (taskTimeout) {
    // Normal timeout - limit each individual execution attempt
    activityOptions.startToCloseTimeout = taskTimeout;
  } else {
    // Unlimited timeout - set scheduleToCloseTimeout to a very large value (10 years)
    // This satisfies Temporal's requirement while effectively allowing unlimited execution
    activityOptions.scheduleToCloseTimeout = "87600h"; // 10 years
  }

  const { executeTask } = proxyActivities(activityOptions);

  // Check history limits BEFORE starting the task, so continue_from_task
  // points to a task that hasn't run yet (avoids duplicate execution).
  if (workflowInfo().continueAsNewSuggested) {
    logger.info(`ContinueAsNew suggested by Temporal before task ${task.name}`);
    return await continueAsNew(
      {
        workflow_name: workflow.name,
        execution_mode: "continue_as_new" as const,
        continue_from_task: task.name,
      },
      inputData,
    );
  }

  // Execute the activity directly — no polling monitor.
  // A running activity does not generate workflow history events, so the
  // history stays small even for long-running (timeout: "never") tasks.
  const result = await executeTask(workflow, task, inputData);

  const results = [result];

  if (!task.config.onComplete?.length) {
    return results;
  }

  for (const childTask of task.config.onComplete) {
    const childResult = await handleTask(workflow, childTask, result);
    results.push(...childResult);
  }

  // Check if this is an ETL extract task that needs to loop
  // ETL extract tasks end with "_extract" and return BatchResult with hasMore
  if (
    task.name.endsWith("_extract") &&
    result &&
    typeof result === "object" &&
    "hasMore" in result &&
    (result as any).hasMore === true
  ) {
    logger.info(`Extract task ${task.name} has more data, restarting chain...`);

    // Recursively call the extract task again to get the next batch
    const nextBatchResults = await handleTask(workflow, task, null);
    results.push(...nextBatchResults);
  }

  return results;
}
