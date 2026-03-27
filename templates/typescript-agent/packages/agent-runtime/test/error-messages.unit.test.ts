import { describe, expect, it } from "vitest";

import { formatAgentRuntimeErrorMessage } from "../src";

describe("formatAgentRuntimeErrorMessage", () => {
  it("maps Bedrock access denials to a user-friendly message", () => {
    expect(
      formatAgentRuntimeErrorMessage(
        new Error("AccessDeniedException: not authorized to invoke model"),
      ),
    ).toContain("Model access denied.");
  });

  it("preserves other runtime error messages", () => {
    expect(
      formatAgentRuntimeErrorMessage(new Error("Something else broke")),
    ).toBe("Something else broke");
  });
});
