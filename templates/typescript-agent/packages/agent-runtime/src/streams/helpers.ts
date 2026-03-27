import type { UIMessage, UIMessageStreamWriter } from "ai";
import type { TokenUsage } from "../utils/sdk-types.js";

export function getInputTokens(usage?: TokenUsage) {
  return usage?.inputTokens ?? 0;
}

export function getOutputTokens(usage?: TokenUsage) {
  return usage?.outputTokens ?? 0;
}

export function writeAgentMarker(
  writer: UIMessageStreamWriter<UIMessage>,
  agentName: string,
  text: string,
) {
  const textId = crypto.randomUUID();

  writer.write({
    type: "text-start",
    id: textId,
  });
  writer.write({
    type: "text-delta",
    id: textId,
    delta: `[AGENT:${agentName}] ${text}\n\n`,
  });
  writer.write({
    type: "text-end",
    id: textId,
  });
}
