import { Api } from "@514labs/moose-lib";

interface WorkflowResponse {
  workflowId: string;
  status: string;
}

const triggerApi = new Api<{}, WorkflowResponse>(
  "start-generator-workflow",
  async (_, { client }) => {
    // Trigger the workflow with input parameters
    const workflowExecution = await client.workflow.execute("generator", {});

    return {
      workflowId: workflowExecution.body,
      status: "started",
    };
  },
);

const terminateAPI = new Api<{}, WorkflowResponse>(
  "terminate-generator-workflow",
  async (_, { client }) => {
    // Terminate the workflow by name
    const workflowExecution = await client.workflow.terminate("generator");

    return {
      workflowId: workflowExecution.body,
      status: "terminated",
    };
  },
);

export { triggerApi, terminateAPI };
