import { setupStructuredConsole } from "../utils/structured-logging";

// Task context storage - shared across logger and activity modules
export const taskContextStorage = setupStructuredConsole<{ taskName: string }>(
  (ctx) => ctx.taskName,
  "task_name",
);

// Re-export constants for use in logger
export const TASK_CONTEXT_FIELD_NAME = "task_name";
export const getTaskContextField = (ctx: { taskName: string }) => ctx.taskName;
