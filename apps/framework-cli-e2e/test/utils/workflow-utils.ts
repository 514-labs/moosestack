import { SERVER_CONFIG } from "../constants";
import { withRetries } from "./retry-utils";

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

export const getWorkflowStatus = async (
  workflowId: string,
  options?: {
    runId?: string;
    verbose?: boolean;
  },
): Promise<{
  workflow_name: string;
  run_id: string;
  status: string;
  status_emoji: string;
  execution_time_seconds: number;
  start_time: string;
  events?: Array<{
    timestamp: string;
    type: string;
    [key: string]: any;
  }>;
  failure_summary?: {
    error: string;
    error_type?: string;
    details?: string;
    stack?: string;
  };
}> => {
  let url = `${SERVER_CONFIG.url}/workflows/${workflowId}/status`;

  const params = new URLSearchParams();
  if (options?.runId) params.append("run_id", options.runId);
  if (options?.verbose) params.append("verbose", "true");

  if (params.toString()) {
    url += `?${params.toString()}`;
  }

  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text}`);
  }

  return await response.json();
};
