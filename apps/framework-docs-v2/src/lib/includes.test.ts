import { describe, expect, it } from "vitest";
import { INCLUDE_REGEX } from "./includes";

describe("INCLUDE_REGEX", () => {
  it("matches unindented include directives", () => {
    INCLUDE_REGEX.lastIndex = 0;
    const content = ":::include /shared/guides/foo.mdx";
    const matches = [...content.matchAll(INCLUDE_REGEX)];

    expect(matches).toHaveLength(1);
    expect(matches[0]?.[1]).toBe("/shared/guides/foo.mdx");
  });

  it("matches include directives with leading indentation", () => {
    INCLUDE_REGEX.lastIndex = 0;
    const content = "    :::include /shared/guides/foo.mdx";
    const matches = [...content.matchAll(INCLUDE_REGEX)];

    expect(matches).toHaveLength(1);
    expect(matches[0]?.[1]).toBe("/shared/guides/foo.mdx");
  });
});
