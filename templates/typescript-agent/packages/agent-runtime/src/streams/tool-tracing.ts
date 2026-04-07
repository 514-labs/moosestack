import type { UIMessage, UIMessageStreamWriter } from "ai";
import type { AgentStepRecord } from "../observability-contract.js";
import {
  getToolCallId,
  hasExecutableTool,
  isObjectRecord,
} from "../utils/message-parts.js";
import type { AgentTools, ToolTiming } from "../utils/sdk-types.js";

function formatToolArgs(args: unknown): string {
  return JSON.stringify(args) ?? "";
}

export function wrapTools(options: {
  runtimeTools: AgentTools;
  accessScopeId: string;
  traceId: string;
  toolCallTimings: Map<string, ToolTiming>;
  getStepNumber: () => number;
  recordStep: (step: AgentStepRecord) => void;
}) {
  const wrappedTools: AgentTools = {};

  for (const [toolName, tool] of Object.entries(options.runtimeTools)) {
    if (!isObjectRecord(tool) || !hasExecutableTool(tool)) {
      wrappedTools[toolName] = tool;
      continue;
    }

    wrappedTools[toolName] = {
      ...tool,
      execute: async (args: unknown, context: unknown) => {
        const toolCallId = getToolCallId(context);
        const startedAt = new Date().toISOString();
        const startTime = Date.now();

        try {
          const result = await tool.execute(args, context);
          const duration = Date.now() - startTime;

          if (toolCallId) {
            options.toolCallTimings.set(toolCallId, {
              duration,
              toolName,
              stepNumber: options.getStepNumber(),
            });
          }

          options.recordStep({
            stepId: crypto.randomUUID(),
            traceId: options.traceId,
            accessScopeId: options.accessScopeId,
            stepType: "tool",
            toolName,
            status: "completed",
            notes: formatToolArgs(args),
            startedAt,
            durationMs: duration,
            inputTokens: 0,
            outputTokens: 0,
          });

          return result;
        } catch (error) {
          const duration = Date.now() - startTime;

          if (toolCallId) {
            options.toolCallTimings.set(toolCallId, {
              duration,
              toolName,
              stepNumber: options.getStepNumber(),
            });
          }

          options.recordStep({
            stepId: crypto.randomUUID(),
            traceId: options.traceId,
            accessScopeId: options.accessScopeId,
            stepType: "tool",
            toolName,
            status: "failed",
            notes:
              error instanceof Error ? error.message : "Unknown tool error",
            startedAt,
            durationMs: duration,
            inputTokens: 0,
            outputTokens: 0,
          });

          throw error;
        }
      },
    };
  }

  return wrappedTools;
}

export function emitToolTimings(
  writer: UIMessageStreamWriter<UIMessage>,
  toolCallTimings: Map<string, ToolTiming>,
  toolCalls: readonly { toolCallId: string }[],
) {
  toolCalls.forEach((toolCall) => {
    const timing = toolCallTimings.get(toolCall.toolCallId);
    if (!timing) {
      return;
    }

    writer.write({
      type: "data-tool-timing",
      data: {
        toolCallId: toolCall.toolCallId,
        duration: timing.duration,
        stepNumber: timing.stepNumber,
        toolName: timing.toolName,
      },
    });

    toolCallTimings.delete(toolCall.toolCallId);
  });
}
