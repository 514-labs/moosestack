import {
  UIMessage,
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { getAnthropicAgentStreamTextOptions } from "./agent-config";

export async function getAgentResponse(messages: UIMessage[]) {
  const streamTextOptions = await getAnthropicAgentStreamTextOptions(messages);

  let stepStartTime = Date.now();
  let stepCount = 0;

  const stream = createUIMessageStream({
    execute: async ({ writer }) => {
      stepStartTime = Date.now();

      const result = streamText({
        ...streamTextOptions,
        onStepFinish: async (stepResult) => {
          const stepEndTime = Date.now();
          const stepDuration = stepEndTime - stepStartTime;
          stepCount++;

          if (stepResult.toolCalls && stepResult.toolCalls.length > 0) {
            stepResult.toolCalls.forEach((toolCall) => {
              writer.write({
                type: "data-tool-timing",
                data: {
                  toolCallId: toolCall.toolCallId,
                  duration: stepDuration,
                  stepNumber: stepCount,
                  toolName: toolCall.toolName,
                },
              });
            });
          }

          stepStartTime = Date.now();
        },
      });

      // Merge the AI response stream with our custom data stream
      writer.merge(result.toUIMessageStream());
    },
  });

  return createUIMessageStreamResponse({ stream });
}
