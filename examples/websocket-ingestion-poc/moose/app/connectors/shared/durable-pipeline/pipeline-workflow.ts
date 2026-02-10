import { Task, Workflow } from "@514labs/moose-lib";
import { PipelineControl } from "./types";

interface PipelineTaskState {
  pipeline?: PipelineControl;
  cleanupPromise?: Promise<void>;
}

interface PipelineTaskContext {
  state: unknown;
}

export interface LongRunningPipelineWorkflowConfig {
  workflowName: string;
  taskName: string;
  startPipeline: () => Promise<PipelineControl>;
}

function getState(context: PipelineTaskContext): PipelineTaskState {
  return context.state as PipelineTaskState;
}

async function cleanupPipeline(context: PipelineTaskContext): Promise<void> {
  const state = getState(context);
  if (!state.pipeline) {
    return;
  }

  if (!state.cleanupPromise) {
    state.cleanupPromise = state.pipeline.stop();
  }

  await state.cleanupPromise;
  state.pipeline = undefined;
}

export function createLongRunningPipelineWorkflow(
  config: LongRunningPipelineWorkflowConfig,
): Workflow {
  const runPipelineTask = new Task<null, void>(config.taskName, {
    run: async (context) => {
      const state = getState(context);
      state.cleanupPromise = undefined;
      state.pipeline = await config.startPipeline();

      try {
        await state.pipeline.done;
      } finally {
        await cleanupPipeline(context);
      }
    },
    onCancel: async (context) => {
      await cleanupPipeline(context);
    },
    timeout: "never",
    retries: 0,
  });

  return new Workflow(config.workflowName, {
    startingTask: runPipelineTask,
    timeout: "never",
    retries: 0,
  });
}
