import * as util from "util";
import { AsyncLocalStorage } from "async_hooks";

/**
 * Safely serializes a value to a string, handling circular references and BigInt.
 *
 * This function attempts JSON.stringify first, then falls back to util.inspect
 * for values that cannot be serialized (circular references, BigInt, etc.).
 *
 * @param arg - The value to serialize (can be any type)
 * @returns A string representation of the value
 */
export function safeStringify(arg: unknown): string {
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
    if (context) {
      // We're in a context - emit structured log
      const message = args.map((arg) => safeStringify(arg)).join(" ");
      process.stderr.write(
        JSON.stringify({
          __moose_structured_log__: true,
          level,
          message,
          [contextFieldName]: getContextField(context),
          timestamp: new Date().toISOString(),
        }) + "\n",
      );
    } else {
      // Not in context - use original console
      originalMethod(...args);
    }
  };
}
