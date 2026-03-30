import { createUIMessageStream } from "ai";

export function createGuardrailBlockedStream(details: string[]) {
  return createUIMessageStream({
    execute: ({ writer }) => {
      const textId = "guardrail-block";
      writer.write({
        type: "text-start",
        id: textId,
      });
      writer.write({
        type: "text-delta",
        id: textId,
        delta:
          "The request was blocked by the configured guardrails before a model call was made.\n\n" +
          details.join("\n"),
      });
      writer.write({
        type: "text-end",
        id: textId,
      });
    },
  });
}
