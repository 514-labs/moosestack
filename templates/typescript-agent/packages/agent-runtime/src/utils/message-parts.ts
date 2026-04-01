import type { UIMessage } from "ai";
import type { ExecutableTool } from "./sdk-types.js";

export function isObjectRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTextPart(part: unknown): part is { type: "text"; text: string } {
  return (
    isObjectRecord(part) &&
    part.type === "text" &&
    typeof part.text === "string"
  );
}

export function hasExecutableTool(tool: unknown): tool is ExecutableTool {
  return isObjectRecord(tool) && typeof tool.execute === "function";
}

export function getToolCallId(context: unknown): string | undefined {
  if (!isObjectRecord(context) || typeof context.toolCallId !== "string") {
    return undefined;
  }

  return context.toolCallId;
}

export function extractUserPrompt(messages: UIMessage[]): string {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");

  return (
    lastUserMessage?.parts
      ?.filter(isTextPart)
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}
