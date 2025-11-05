import {
  UIMessage,
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { getAnthropicAgentStreamTextOptions } from "./agent-config";

export async function getAgentResponse(messages: UIMessage[]) {
  const streamTextOptions = await getAnthropicAgentStreamTextOptions(messages);

  let stepCount = 0;
  const toolCallTimings = new Map<
    string,
    { duration: number; toolName: string; stepNumber: number }
  >();

  // Wrap tools to track execution timing
  const wrappedTools: Record<string, any> = {};
  if (streamTextOptions.tools && typeof streamTextOptions.tools === "object") {
    for (const [toolName, tool] of Object.entries(streamTextOptions.tools)) {
      if (tool && typeof tool === "object") {
        wrappedTools[toolName] = {
          ...(tool as Record<string, any>),
          execute: async (args: any, context: any) => {
            const toolCallId = context?.toolCallId;

            // Record start time right before tool call execution
            const startTime = Date.now();

            try {
              // Execute the actual tool
              const result = await (tool as any).execute(args, context);

              // Record end time right after tool call execution
              const endTime = Date.now();
              const duration = endTime - startTime;

              // Store timing data if we have a toolCallId
              if (toolCallId) {
                toolCallTimings.set(toolCallId, {
                  duration,
                  toolName,
                  stepNumber: stepCount + 1,
                });
              }

              return result;
            } catch (error) {
              // Still record timing even on error
              if (toolCallId) {
                const endTime = Date.now();
                const duration = endTime - startTime;
                toolCallTimings.set(toolCallId, {
                  duration,
                  toolName,
                  stepNumber: stepCount + 1,
                });
              }

              throw error;
            }
          },
        };
      }
    }
  }

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      const result = streamText({
        ...streamTextOptions,
        tools:
          Object.keys(wrappedTools).length > 0 ?
            wrappedTools
          : streamTextOptions.tools,
        onStepFinish: async (stepResult) => {
          stepCount++;

          // Handle tool call timings
          if (stepResult.toolCalls && stepResult.toolCalls.length > 0) {
            stepResult.toolCalls.forEach((toolCall) => {
              const timing = toolCallTimings.get(toolCall.toolCallId);
              if (timing) {
                writer.write({
                  type: "data-tool-timing",
                  data: {
                    toolCallId: toolCall.toolCallId,
                    duration: timing.duration,
                    stepNumber: timing.stepNumber,
                    toolName: timing.toolName,
                  },
                });
                // Clean up
                toolCallTimings.delete(toolCall.toolCallId);
              }
            });
          }
        },
      });

      // Merge the AI response stream with our custom data stream
      writer.merge(result.toUIMessageStream());
    },
  });

  return createUIMessageStreamResponse({ stream });
}
