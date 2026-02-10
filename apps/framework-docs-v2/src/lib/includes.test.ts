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

  it("does not match include directives without a path", () => {
    INCLUDE_REGEX.lastIndex = 0;
    const emptyDirective = [...":::include".matchAll(INCLUDE_REGEX)];

    INCLUDE_REGEX.lastIndex = 0;
    const whitespaceOnlyDirective = [
      ...":::include   ".matchAll(INCLUDE_REGEX),
    ];

    expect(emptyDirective).toHaveLength(0);
    expect(whitespaceOnlyDirective).toHaveLength(0);
  });

  it("does not match partial include keywords", () => {
    INCLUDE_REGEX.lastIndex = 0;
    const matches = [...":::included /foo.mdx".matchAll(INCLUDE_REGEX)];

    expect(matches).toHaveLength(0);
  });

  it("does not match include directives indented with tabs", () => {
    INCLUDE_REGEX.lastIndex = 0;
    const matches = [
      ..."\t:::include /shared/guides/foo.mdx".matchAll(INCLUDE_REGEX),
    ];

    expect(matches).toHaveLength(0);
  });
});
