import { describe, expect, it } from "vitest";
import { getAllTemplates } from "./templates";

describe("getAllTemplates", () => {
  it("uses explicit template metadata from template.config.toml", () => {
    const template = getAllTemplates().find(
      (entry) => entry.name === "typescript-agent",
    );

    expect(template).toBeDefined();
    expect(template?.frameworks).toEqual(["Next.js", "MCP", "Agents"]);
    expect(template?.features).toEqual([
      "Moose OLAP",
      "Moose APIs",
      "Frontend",
      "MCP",
      "Auth",
      "Agents",
    ]);
  });
});
