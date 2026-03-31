import { describe, expect, it } from "vitest";

import { formatChatUiErrorMessage } from "../src/lib/chat-ui-errors";

describe("formatChatUiErrorMessage", () => {
  it("maps stream parser failures to compatibility guidance", () => {
    expect(
      formatChatUiErrorMessage(
        "Failed to parse stream response from /api/chat",
      ),
    ).toContain("Stream format incompatible.");
  });

  it("preserves other chat error messages", () => {
    expect(formatChatUiErrorMessage("MCP server unavailable")).toBe(
      "MCP server unavailable",
    );
  });

  it("returns the generic failure for empty or whitespace-only input", () => {
    expect(formatChatUiErrorMessage("")).toContain("chat request failed");
    expect(formatChatUiErrorMessage("   ")).toContain("chat request failed");
  });
});
