import type { UIMessage } from "ai";

export type ChatMessagePart = NonNullable<UIMessage["parts"]>[number];

export type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-available"
  | "output-error";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ReasoningDetail {
  type: string;
  text?: string;
}

export interface ReasoningPart {
  type: "reasoning";
  details?: ReasoningDetail[];
}

export interface SourceReference {
  title?: string;
  url?: string;
}

export interface SourcePart {
  type: "source-url" | "source-document";
  source?: SourceReference;
}

export interface ToolContentPart {
  type: string;
  text?: string;
}

export interface ToolPart {
  type: `tool-${string}` | "dynamic-tool";
  toolCallId: string;
  toolName?: string;
  state: ToolState;
  input?: Record<string, unknown>;
  output?: unknown;
  errorText?: string;
  providerExecuted?: boolean;
}

export interface ToolTimingPayload {
  toolCallId: string;
  duration: number;
  stepNumber: number;
  toolName: string;
}

export interface ToolTimingEvent {
  type: "data-tool-timing";
  data: ToolTimingPayload;
}

export function isObjectRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isTextPart(part: unknown): part is TextPart {
  return (
    isObjectRecord(part) &&
    part.type === "text" &&
    typeof part.text === "string"
  );
}

export function isReasoningPart(part: unknown): part is ReasoningPart {
  return isObjectRecord(part) && part.type === "reasoning";
}

export function isSourcePart(part: unknown): part is SourcePart {
  return (
    isObjectRecord(part) &&
    (part.type === "source-url" || part.type === "source-document")
  );
}

export function isToolPart(part: unknown): part is ToolPart {
  return (
    isObjectRecord(part) &&
    typeof part.toolCallId === "string" &&
    typeof part.type === "string" &&
    (part.type === "dynamic-tool" || part.type.startsWith("tool-")) &&
    (part.state === "input-streaming" ||
      part.state === "input-available" ||
      part.state === "output-available" ||
      part.state === "output-error")
  );
}

export function isToolTimingEvent(data: unknown): data is ToolTimingEvent {
  return (
    isObjectRecord(data) &&
    data.type === "data-tool-timing" &&
    isObjectRecord(data.data) &&
    typeof data.data.toolCallId === "string" &&
    typeof data.data.duration === "number" &&
    typeof data.data.stepNumber === "number" &&
    typeof data.data.toolName === "string"
  );
}

export function extractTextFromParts(parts: readonly unknown[] | undefined) {
  return (
    parts
      ?.filter(isTextPart)
      .map((part) => part.text)
      .join("") ?? ""
  );
}

export function extractTextContentParts(value: unknown) {
  if (!isObjectRecord(value) || !Array.isArray(value.content)) {
    return "";
  }

  return value.content
    .filter((part): part is ToolContentPart => {
      return isObjectRecord(part) && typeof part.type === "string";
    })
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("");
}

export function hasOutputError(
  value: unknown,
): value is { isError: boolean } & Record<string, unknown> {
  return isObjectRecord(value) && typeof value.isError === "boolean";
}

export function getToolName(part: ToolPart) {
  return (
    part.toolName ??
    (part.type.startsWith("tool-") ? part.type.slice(5) : part.type)
  );
}

export function createMessagePartKeyFactory(messageId: string) {
  const keyCounts = new Map<string, number>();

  return (part: unknown) => {
    const baseKey = (() => {
      if (isTextPart(part)) {
        return `${messageId}:text:${part.text}`;
      }
      if (isReasoningPart(part)) {
        return `${messageId}:reasoning:${JSON.stringify(part.details ?? [])}`;
      }
      if (isSourcePart(part)) {
        return `${messageId}:${part.type}:${part.source?.url ?? ""}:${part.source?.title ?? ""}`;
      }
      if (isToolPart(part)) {
        return `${messageId}:tool:${getToolName(part)}:${part.toolCallId}:${part.state}`;
      }
      if (isObjectRecord(part) && typeof part.type === "string") {
        return `${messageId}:${part.type}:${JSON.stringify(part)}`;
      }
      return `${messageId}:unknown:${JSON.stringify(part)}`;
    })();

    const occurrence = keyCounts.get(baseKey) ?? 0;
    keyCounts.set(baseKey, occurrence + 1);

    return `${baseKey}:${occurrence}`;
  };
}
