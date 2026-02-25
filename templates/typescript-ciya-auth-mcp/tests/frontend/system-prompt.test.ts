import { describe, it, expect } from "vitest";
import { getAISystemPrompt } from "../../packages/web-app/src/features/chat/system-prompt";

describe("getAISystemPrompt", () => {
  it("returns base prompt when no userContext provided", () => {
    const prompt = getAISystemPrompt();
    expect(prompt).toContain("You are a helpful AI assistant");
    expect(prompt).not.toContain("current user's identity");
  });

  it("returns base prompt when userContext is undefined", () => {
    const prompt = getAISystemPrompt(undefined);
    expect(prompt).toContain("You are a helpful AI assistant");
    expect(prompt).not.toContain("current user's identity");
  });

  it("appends full identity when all fields present", () => {
    const prompt = getAISystemPrompt({
      userId: "user_123",
      name: "Alice Smith",
      email: "alice@acme.com",
      orgId: "org_acme",
    });

    expect(prompt).toContain("current user's identity");
    expect(prompt).toContain("name: Alice Smith");
    expect(prompt).toContain("email: alice@acme.com");
    expect(prompt).toContain("organization: org_acme");
  });

  it("appends only name when only name is set (Tier 2 partial)", () => {
    const prompt = getAISystemPrompt({ name: "Bob" });

    expect(prompt).toContain("name: Bob");
    expect(prompt).not.toContain("email:");
    expect(prompt).not.toContain("organization:");
  });

  it("does not append identity section when userContext has no fields set", () => {
    const prompt = getAISystemPrompt({});
    expect(prompt).not.toContain("current user's identity");
  });

  it("does not append identity section when only userId is set", () => {
    // userId is not included in the identity display — only name, email, orgId
    const prompt = getAISystemPrompt({ userId: "user_123" });
    expect(prompt).not.toContain("current user's identity");
  });

  it("includes instruction to never expose raw user IDs", () => {
    const prompt = getAISystemPrompt({
      name: "Alice",
      email: "alice@acme.com",
    });
    expect(prompt).toContain("Never expose raw user IDs");
  });

  it("includes instruction to address user by name", () => {
    const prompt = getAISystemPrompt({ name: "Charlie" });
    expect(prompt).toContain("address the user by name");
  });

  it("includes base prompt instructions for tool usage", () => {
    const prompt = getAISystemPrompt();
    expect(prompt).toContain("Use the available tools");
    expect(prompt).toContain("Be helpful, accurate");
  });

  it("appends email and org without name (Tier 3 edge case)", () => {
    const prompt = getAISystemPrompt({
      email: "dana@globex.com",
      orgId: "org_globex",
    });

    expect(prompt).toContain("email: dana@globex.com");
    expect(prompt).toContain("organization: org_globex");
    expect(prompt).not.toContain("name:");
  });
});
