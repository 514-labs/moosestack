import {
  makeTelemetryFilterString,
  DefaultLogger,
  Runtime,
} from "@temporalio/worker";
import { emitStructuredLog } from "../utils/structured-logging";
import {
  taskContextStorage,
  getTaskContextField,
  TASK_CONTEXT_FIELD_NAME,
} from "./task-context";

class LoggerSingleton {
  private static instance: DefaultLogger | null = null;

  private constructor() {}

  public static initializeLogger(): DefaultLogger {
    if (!LoggerSingleton.instance) {
      LoggerSingleton.instance = new DefaultLogger(
        "DEBUG",
        ({ level, message }) => {
          const structuredLevel = level.toLowerCase();

          // Try to emit as structured log if in task context
          const emitted = emitStructuredLog(
            taskContextStorage,
            getTaskContextField,
            TASK_CONTEXT_FIELD_NAME,
            structuredLevel,
            message,
          );

          // If not in context, emit as regular log
          if (!emitted) {
            console.log(`${level} | ${message}`);
          }
        },
      );

      Runtime.install({
        logger: LoggerSingleton.instance,
        telemetryOptions: {
          logging: {
            filter: makeTelemetryFilterString({ core: "INFO", other: "INFO" }),
            forward: {},
          },
        },
      });
    }

    return LoggerSingleton.instance;
  }

  public static getInstance(): DefaultLogger {
    return LoggerSingleton.instance!;
  }
}

export const initializeLogger = LoggerSingleton.initializeLogger;
