import { getMooseInternal } from "../internal";

/**
 * Context passed to task handlers. Single param to future-proof API changes.
 *
 * - state: shared mutable state for the task and its lifecycle hooks
 * - input: optional typed input for the task (undefined when task has no input)
 */
/**
 * Task handler context. If the task declares an input type (T != null),
 * `input` is required and strongly typed. For no-input tasks (T = null),
 * `input` is omitted/optional.
 */
export type TaskContext<TInput> =
  TInput extends null ? { state: any; input?: null }
  : { state: any; input: TInput };

/**
 * Configuration options for defining a task within a workflow.
 *
 * @template T - The input type for the task
 * @template R - The return type for the task
 */
export interface TaskConfig<T, R> {
  /** The main function that executes the task logic */
  run: (context: TaskContext<T>) => Promise<R>;

  /**
   * Optional array of tasks to execute after this task completes successfully.
   * Supports all combinations of input types (real type or null) and output types (real type or void).
   * When this task returns void, onComplete tasks expect null as input.
   * When this task returns a real type, onComplete tasks expect that type as input.
   */
  onComplete?: (
    | Task<R extends void ? null : R, any>
    | Task<R extends void ? null : R, void>
  )[];

  /**
   * Optional function that is called when the task is cancelled.
   */
  /** Optional function that is called when the task is cancelled. */
  onCancel?: (context: TaskContext<T>) => Promise<void>;

  /** Optional timeout duration for the task execution (e.g., "30s", "5m") */
  timeout?: string;

  /** Optional number of retry attempts if the task fails */
  retries?: number;
}

/**
 * Represents a single task within a workflow system.
 *
 * A Task encapsulates the execution logic, completion handlers, and configuration
 * for a unit of work that can be chained with other tasks in a workflow.
 *
 * @template T - The input type that this task expects
 * @template R - The return type that this task produces
 */
export class Task<T, R> {
  /**
   * Creates a new Task instance.
   *
   * @param name - Unique identifier for the task
   * @param config - Configuration object defining the task behavior
   *
   * @example
   * ```typescript
   * // No input, no output
   * const task1 = new Task<null, void>("task1", {
   *   run: async () => {
   *     console.log("No input/output");
   *   }
   * });
   *
   * // No input, but has output
   * const task2 = new Task<null, OutputType>("task2", {
   *   run: async () => {
   *     return someOutput;
   *   }
   * });
   *
   * // Has input, no output
   * const task3 = new Task<InputType, void>("task3", {
   *   run: async (input: InputType) => {
   *     // process input but return nothing
   *   }
   * });
   *
   * // Has both input and output
   * const task4 = new Task<InputType, OutputType>("task4", {
   *   run: async (input: InputType) => {
   *     return process(input);
   *   }
   * });
   * ```
   */
  constructor(
    readonly name: string,
    readonly config: TaskConfig<T, R>,
  ) {}
}

/**
 * Configuration options for defining a workflow.
 *
 * A workflow orchestrates the execution of multiple tasks in a defined sequence
 * or pattern, with support for scheduling, retries, and timeouts.
 */
export interface WorkflowConfig {
  /**
   * The initial task that begins the workflow execution.
   * Supports all combinations of input types (real type or null) and output types (real type or void):
   * - Task<null, OutputType>: No input, returns a type
   * - Task<null, void>: No input, returns nothing
   * - Task<InputType, OutputType>: Has input, returns a type
   * - Task<InputType, void>: Has input, returns nothing
   */
  startingTask:
    | Task<null, any>
    | Task<null, void>
    | Task<any, any>
    | Task<any, void>;

  /** Optional number of retry attempts if the entire workflow fails */
  retries?: number;

  /** Optional timeout duration for the entire workflow execution (e.g., "10m", "1h") */
  timeout?: string;

  /** Optional cron-style schedule string for automated workflow execution */
  schedule?: string;
}

/**
 * Represents a complete workflow composed of interconnected tasks.
 *
 * A Workflow manages the execution flow of multiple tasks, handling scheduling,
 * error recovery, and task orchestration. Once created, workflows are automatically
 * registered with the internal Moose system.
 *
 * @example
 * ```typescript
 * const dataProcessingWorkflow = new Workflow("dataProcessing", {
 *   startingTask: extractDataTask,
 *   schedule: "0 2 * * *", // Run daily at 2 AM
 *   timeout: "1h",
 *   retries: 2
 * });
 * ```
 */
export class Workflow {
  /**
   * Creates a new Workflow instance and registers it with the Moose system.
   *
   * @param name - Unique identifier for the workflow
   * @param config - Configuration object defining the workflow behavior and task orchestration
   * @throws {Error} When the workflow contains null/undefined tasks or infinite loops
   */
  constructor(
    readonly name: string,
    readonly config: WorkflowConfig,
  ) {
    const workflows = getMooseInternal().workflows;
    if (workflows.has(name)) {
      throw new Error(`Workflow with name ${name} already exists`);
    }
    this.validateTaskGraph(config.startingTask, name);
    workflows.set(name, this);
  }

  /**
   * Validates the task graph to ensure there are no null tasks or infinite loops.
   *
   * @private
   * @param startingTask - The starting task to begin validation from
   * @param workflowName - The name of the workflow being validated (for error messages)
   * @throws {Error} When null/undefined tasks are found or infinite loops are detected
   */
  private validateTaskGraph(
    startingTask: Task<any, any> | null | undefined,
    workflowName: string,
  ): void {
    if (startingTask === null || startingTask === undefined) {
      throw new Error(
        `Workflow "${workflowName}" has a null or undefined starting task`,
      );
    }

    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const validateTask = (
      task: Task<any, any> | null | undefined,
      currentPath: string[],
    ): void => {
      if (task === null || task === undefined) {
        const pathStr =
          currentPath.length > 0 ? currentPath.join(" -> ") + " -> " : "";
        throw new Error(
          `Workflow "${workflowName}" contains a null or undefined task in the task chain: ${pathStr}null`,
        );
      }

      const taskName = task.name;

      if (recursionStack.has(taskName)) {
        const cycleStartIndex = currentPath.indexOf(taskName);
        const cyclePath =
          cycleStartIndex >= 0 ?
            currentPath.slice(cycleStartIndex).concat(taskName)
          : currentPath.concat(taskName);
        throw new Error(
          `Workflow "${workflowName}" contains an infinite loop in task chain: ${cyclePath.join(" -> ")}`,
        );
      }

      if (visited.has(taskName)) {
        // Already processed this task and its children
        return;
      }

      visited.add(taskName);
      recursionStack.add(taskName);

      if (task.config.onComplete) {
        for (const nextTask of task.config.onComplete) {
          validateTask(nextTask, [...currentPath, taskName]);
        }
      }

      recursionStack.delete(taskName);
    };

    validateTask(startingTask, []);
  }
}
