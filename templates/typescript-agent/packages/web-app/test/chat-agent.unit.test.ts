import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("chat-agent wiring", () => {
  it("uses the single-agent runtime for the default chat experience", () => {
    const source = readFileSync(new URL("../src/lib/chat-agent.ts", import.meta.url), "utf8");

    expect(source).toContain("createAgentStream");
    expect(source).not.toContain("createMultiAgentStream");
    expect(source).toContain("const stream = await createAgentStream({");
  });
});
