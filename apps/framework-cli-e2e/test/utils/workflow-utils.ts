import { SERVER_CONFIG } from "../constants";
import { withRetries } from "./retry-utils";
import { logger } from "./logger";

const workflowLogger = logger.scope("utils:workflow");

// Temporal UI API endpoint (default local dev setup)
const TEMPORAL_UI_URL = "http://localhost:8080";
const TEMPORAL_NAMESPACE = "default";

interface TriggerResponse {
  workflow_id: string;
  run_id: string;
  dashboardUrl?: string;
}

interface WorkflowInfo {
  name: string;
  run_id: string;
  status: string;
  started_at: string;
  duration: string;
}

interface WorkflowFailureDetails {
  error?: string;
  errorType?: string;
  details?: string;
  stack?: string;
}

/**
 * Fetches workflow failure details from Temporal's API
 */
const getWorkflowFailureFromTemporal = async (
  workflowId: string,
  runId: string,
): Promise<WorkflowFailureDetails | undefined> => {
  try {
    // Temporal UI API endpoint for workflow history
    const url = `${TEMPORAL_UI_URL}/api/v1/namespaces/${TEMPORAL_NAMESPACE}/workflows/${workflowId}/runs/${runId}/events?maximumPageSize=100`;

    const response = await fetch(url);
    if (!response.ok) {
      workflowLogger.debug(
        `Failed to fetch Temporal history: ${response.status}`,
      );
      return undefined;
    }

    const data = await response.json();
    const events = data.events || data.history?.events || [];

    // Look for failure events in the history
    for (const event of events) {
      const eventType = event.eventType || event.event_type;

      // Check for workflow execution failed event
      if (
        eventType === "EVENT_TYPE_WORKFLOW_EXECUTION_FAILED" ||
        eventType === "WorkflowExecutionFailed"
      ) {
        const attrs =
          event.workflowExecutionFailedEventAttributes ||
          event.workflow_execution_failed_event_attributes;
        if (attrs?.failure) {
          return extractFailureInfo(attrs.failure);
        }
      }

      // Check for activity task failed event
      if (
        eventType === "EVENT_TYPE_ACTIVITY_TASK_FAILED" ||
        eventType === "ActivityTaskFailed"
      ) {
        const attrs =
          event.activityTaskFailedEventAttributes ||
          event.activity_task_failed_event_attributes;
        if (attrs?.failure) {
          return extractFailureInfo(attrs.failure);
        }
      }
    }

    return undefined;
  } catch (e) {
    workflowLogger.debug(`Error fetching Temporal history: ${e}`);
    return undefined;
  }
};

/**
 * Extract failure information from a Temporal failure object
 */
const extractFailureInfo = (failure: any): WorkflowFailureDetails => {
  const result: WorkflowFailureDetails = {};

  // Get the main error message
  if (failure.message) {
    result.error = failure.message;

    // Try to parse JSON error details from the message
    try {
      const parsed = JSON.parse(failure.message);
      if (parsed.error) result.error = parsed.error;
      if (parsed.details) result.details = parsed.details;
      if (parsed.traceback) result.stack = parsed.traceback;
      if (parsed.error_type) result.errorType = parsed.error_type;
    } catch {
      // Not JSON, use as-is
    }
  }

  // Check for application failure info
  if (failure.applicationFailureInfo) {
    const appInfo = failure.applicationFailureInfo;
    if (appInfo.type) result.errorType = appInfo.type;
    if (appInfo.details?.payloads?.[0]?.data) {
      try {
        const detailsData = Buffer.from(
          appInfo.details.payloads[0].data,
          "base64",
        ).toString();
        result.details = detailsData;
      } catch {
        // Ignore decoding errors
      }
    }
  }

  // Check for cause (nested failure)
  if (failure.cause) {
    const causeInfo = extractFailureInfo(failure.cause);
    // Prefer cause details if main failure doesn't have them
    if (!result.details && causeInfo.details)
      result.details = causeInfo.details;
    if (!result.stack && causeInfo.stack) result.stack = causeInfo.stack;
    if (!result.errorType && causeInfo.errorType)
      result.errorType = causeInfo.errorType;
  }

  // Get stack trace
  if (failure.stackTrace) {
    result.stack = failure.stackTrace;
  }

  return result;
};

export const triggerWorkflow = async (name: string) => {
  await withRetries(
    async () => {
      const response = await fetch(
        `${SERVER_CONFIG.url}/workflows/${name}/trigger`,
        {
          method: "POST",
        },
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }
    },
    { attempts: 5, delayMs: 500 },
  );
};

/**
 * Gets the workflow history filtered by status
 */
export const getWorkflowHistory = async (
  status?: string,
  limit: number = 10,
): Promise<WorkflowInfo[]> => {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  params.set("limit", limit.toString());

  const response = await fetch(
    `${SERVER_CONFIG.url}/workflows/history?${params.toString()}`,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to get workflow history: ${response.status}: ${text}`,
    );
  }

  return response.json();
};

/**
 * Gets the status of a specific workflow run
 */
export const getWorkflowStatus = async (
  runId: string,
): Promise<WorkflowInfo | undefined> => {
  // Get recent workflows and find the one with matching run_id
  const workflows = await getWorkflowHistory(undefined, 100);
  return workflows.find((w) => w.run_id === runId);
};

/**
 * Triggers a workflow and waits for it to complete.
 * Throws an error with details if the workflow fails.
 *
 * @param name - The workflow name to trigger
 * @param timeoutMs - Maximum time to wait for completion (default: 60000ms)
 * @param pollIntervalMs - Interval between status checks (default: 1000ms)
 */
export const triggerWorkflowAndWait = async (
  name: string,
  timeoutMs: number = 60_000,
  pollIntervalMs: number = 1000,
): Promise<void> => {
  // Trigger the workflow and get the run_id
  const triggerResponse = await withRetries(
    async () => {
      const response = await fetch(
        `${SERVER_CONFIG.url}/workflows/${name}/trigger`,
        {
          method: "POST",
        },
      );
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`${response.status}: ${text}`);
      }
      return (await response.json()) as TriggerResponse;
    },
    { attempts: 5, delayMs: 500 },
  );

  const { run_id, dashboardUrl } = triggerResponse;
  workflowLogger.info(
    `Workflow '${name}' triggered with run_id: ${run_id}`,
    dashboardUrl ? { dashboardUrl } : undefined,
  );

  // Poll for workflow completion
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const workflowInfo = await getWorkflowStatus(run_id);

    if (!workflowInfo) {
      // Workflow not found yet, keep polling
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }

    const status = workflowInfo.status;

    if (status === "WORKFLOW_EXECUTION_STATUS_COMPLETED") {
      workflowLogger.info(
        `Workflow '${name}' completed successfully (run_id: ${run_id}, duration: ${workflowInfo.duration})`,
      );
      return;
    }

    if (status === "WORKFLOW_EXECUTION_STATUS_FAILED") {
      // Fetch detailed error from Temporal's API
      const failureDetails = await getWorkflowFailureFromTemporal(name, run_id);
      let errorMsg = `Workflow '${name}' failed (run_id: ${run_id}, duration: ${workflowInfo.duration})`;

      if (failureDetails) {
        if (failureDetails.error) {
          errorMsg += `\n\nError: ${failureDetails.error}`;
        }
        if (failureDetails.errorType) {
          errorMsg += `\nType: ${failureDetails.errorType}`;
        }
        if (failureDetails.details) {
          errorMsg += `\nDetails: ${failureDetails.details}`;
        }
        if (failureDetails.stack) {
          errorMsg += `\n\nStack trace:\n${failureDetails.stack}`;
        }
      }

      workflowLogger.error(errorMsg, { dashboardUrl });
      throw new Error(errorMsg);
    }

    if (
      status === "WORKFLOW_EXECUTION_STATUS_CANCELED" ||
      status === "WORKFLOW_EXECUTION_STATUS_TERMINATED"
    ) {
      const errorMsg = `Workflow '${name}' was ${status.replace("WORKFLOW_EXECUTION_STATUS_", "").toLowerCase()} (run_id: ${run_id})`;
      workflowLogger.error(errorMsg, { dashboardUrl });
      throw new Error(errorMsg);
    }

    // Still running, keep polling
    workflowLogger.debug(`Workflow '${name}' status: ${status}, waiting...`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Timeout waiting for workflow '${name}' to complete after ${timeoutMs}ms (run_id: ${run_id})`,
  );
};
