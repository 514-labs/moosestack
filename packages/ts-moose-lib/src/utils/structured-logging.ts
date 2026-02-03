import * as util from "util";
import { AsyncLocalStorage } from "async_hooks";

/**
 * Sets up structured console logging by wrapping all console methods.
 * Returns the AsyncLocalStorage for use with .run() during execution.
 *
 * @template TContext - The type of context stored in AsyncLocalStorage
 * @param getContextField - Function to extract the identifying field from context
 * @param contextFieldName - The JSON field name for the context (e.g., "api_name", "task_name")
 * @returns The AsyncLocalStorage instance to use with .run() for setting context
 *
 * @example
 * ```ts
 * const taskContextStorage = setupStructuredConsole<{ taskName: string }>(
 *   (ctx) => ctx.taskName,
 *   "task_name"
 * );
 *
 * // Use with .run() to set context for user code execution
 * await taskContextStorage.run({ taskName: "myTask" }, async () => {
 *   console.log("Hello"); // Emits structured JSON log
 * });
 * ```
 */
export function setupStructuredConsole<TContext>(
  getContextField: (context: TContext) => string,
  contextFieldName: string,
): AsyncLocalStorage<TContext> {
  const contextStorage = new AsyncLocalStorage<TContext>();

  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };

  console.log = createStructuredConsoleWrapper(
    contextStorage,
    getContextField,
    contextFieldName,
    originalConsole.log,
    "info",
  );
  console.info = createStructuredConsoleWrapper(
    contextStorage,
    getContextField,
    contextFieldName,
    originalConsole.info,
    "info",
  );
  console.warn = createStructuredConsoleWrapper(
    contextStorage,
    getContextField,
    contextFieldName,
    originalConsole.warn,
    "warn",
  );
  console.error = createStructuredConsoleWrapper(
    contextStorage,
    getContextField,
    contextFieldName,
    originalConsole.error,
    "error",
  );
  console.debug = createStructuredConsoleWrapper(
    contextStorage,
    getContextField,
    contextFieldName,
    originalConsole.debug,
    "debug",
  );

  return contextStorage;
}

/**
 * Directly emits a structured log if currently in a context, without formatting.
 * Returns true if structured log was emitted, false if not in context.
 *
 * This is useful for framework code that needs to emit structured logs
 * but doesn't go through console.log() wrapper (e.g., Temporal's logger).
 *
 * @template TContext - The type of context stored in AsyncLocalStorage
 * @param contextStorage - The AsyncLocalStorage instance containing execution context
 * @param getContextField - Function to extract the identifying field from context
 * @param contextFieldName - The JSON field name for the context (e.g., "task_name")
 * @param level - The log level (info, warn, error, debug)
 * @param message - The log message
 * @returns true if structured log was emitted, false otherwise
 */
export function emitStructuredLog<TContext>(
  contextStorage: AsyncLocalStorage<TContext>,
  getContextField: (context: TContext) => string,
  contextFieldName: string,
  level: string,
  message: string,
): boolean {
  const context = contextStorage.getStore();
  if (!context) {
    return false;
  }

  let ctxValue: string;
  try {
    ctxValue = getContextField(context);
  } catch {
    ctxValue = "unknown";
  }

  try {
    process.stderr.write(
      JSON.stringify({
        __moose_structured_log__: true,
        level,
        message,
        [contextFieldName]: ctxValue,
        timestamp: new Date().toISOString(),
      }) + "\n",
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Safely serializes a value to a string, handling circular references, BigInt, Symbols, and Error objects.
 *
 * This function:
 * - Preserves Error objects (message and stack) via util.inspect
 * - Attempts JSON.stringify for plain objects, then falls back to util.inspect
 * - Uses util.inspect for non-object types (Symbols, functions, etc.)
 *
 * @param arg - The value to serialize (can be any type)
 * @returns A string representation of the value
 */
function safeStringify(arg: unknown): string {
  if (typeof arg === "object" && arg !== null) {
    // Special-case Error objects: JSON.stringify(new Error("x")) returns "{}"
    // Use util.inspect to preserve message and stack trace
    if (arg instanceof Error) {
      return util.inspect(arg, { depth: 2, breakLength: Infinity });
    }
    try {
      return JSON.stringify(arg);
    } catch (e) {
      // Fall back to util.inspect for circular references or BigInt
      return util.inspect(arg, { depth: 2, breakLength: Infinity });
    }
  }
  // Return strings directly without util.inspect to avoid unwanted quotes
  if (typeof arg === "string") {
    return arg;
  }
  // Use util.inspect for all other non-object types to handle Symbols, functions, etc.
  // String(Symbol()) throws TypeError, but util.inspect handles it correctly
  return util.inspect(arg);
}

/**
 * Creates a structured console wrapper that emits JSON logs when in a context.
 *
 * This factory function creates a console method wrapper that:
 * - Checks if the current execution is within a context (using AsyncLocalStorage)
 * - If in context: emits a structured JSON log to stderr
 * - If not in context: delegates to the original console method
 *
 * This pattern ensures structured logs are only emitted when running user code
 * (APIs, streaming functions, workflow tasks), while preserving normal console
 * behavior for framework code.
 *
 * @template TContext - The type of context stored in AsyncLocalStorage
 * @param contextStorage - The AsyncLocalStorage instance containing execution context
 * @param getContextField - Function to extract the identifying field from context
 * @param contextFieldName - The JSON field name for the context (e.g., "api_name")
 * @param originalMethod - The original console method to call when not in context
 * @param level - The log level (info, warn, error, debug)
 * @returns A wrapped console method that emits structured logs
 */
export function createStructuredConsoleWrapper<TContext>(
  contextStorage: AsyncLocalStorage<TContext>,
  getContextField: (context: TContext) => string,
  contextFieldName: string,
  originalMethod: (...args: unknown[]) => void,
  level: string,
) {
  return (...args: unknown[]) => {
    const context = contextStorage.getStore();
    if (!context) {
      originalMethod(...args);
      return;
    }

    // Safely extract context field - never throws
    let ctxValue: string;
    try {
      ctxValue = getContextField(context);
    } catch {
      ctxValue = "unknown";
    }

    // Emit structured log, fall back to original on any failure
    try {
      const message = args.map((arg) => safeStringify(arg)).join(" ");
      process.stderr.write(
        JSON.stringify({
          __moose_structured_log__: true,
          level,
          message,
          [contextFieldName]: ctxValue,
          timestamp: new Date().toISOString(),
        }) + "\n",
      );
    } catch {
      originalMethod(...args);
    }
  };
}
