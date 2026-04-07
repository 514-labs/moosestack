const STREAM_PROTOCOL_PATTERNS = [
  /Failed to parse stream/i,
  /stream response/i,
  /No separator found/i,
  /Unexpected token </i,
  /Unknown message part type/i,
  /invalid stream/i,
] as const;

export function formatChatUiErrorMessage(message: string): string {
  const trimmedMessage = message.trim();

  if (trimmedMessage.length === 0) {
    return "The chat request failed. Check the web app and Moose service logs for details.";
  }

  if (
    STREAM_PROTOCOL_PATTERNS.some((pattern) => {
      return pattern.test(trimmedMessage);
    })
  ) {
    return "Stream format incompatible. Check that `ai` and `@ai-sdk/react` stay on compatible versions in the generated app.";
  }

  return trimmedMessage;
}
