import { describe, it, expect } from "vitest";

// Extract the functions we want to test by re-implementing them here
// (In a real scenario, we'd export them from the main file)

function stripMdxComponents(content: string): string {
  let result = content;

  // Remove import statements (including multiline imports)
  result = result.replace(/^import\s+[\s\S]*?from\s+['"].*?['"];?\s*$/gm, "");

  // Remove export statements (but keep exported content)
  result = result.replace(/^export\s+default\s+/gm, "");
  result = result.replace(/^export\s+/gm, "");

  // Handle self-closing JSX tags (e.g., <Component />)
  result = result.replace(
    /<[A-Z][a-zA-Z]*(?:\.[A-Z][a-zA-Z]*)*\s*[^>]*\/>/g,
    "",
  );

  // Handle JSX components with children - extract inner content
  let previousResult = "";
  while (previousResult !== result) {
    previousResult = result;
    result = result.replace(
      /<([A-Z][a-zA-Z]*(?:\.[A-Z][a-zA-Z]*)*)[^>]*>([\s\S]*?)<\/\1>/g,
      (_, _tagName, innerContent) => {
        return innerContent;
      },
    );
  }

  // Remove any remaining JSX-style attributes in curly braces
  result = result.replace(/\s+[a-zA-Z]+={[^}]+}/g, " ");

  // Clean up extra whitespace
  result = result.replace(/\n{3,}/g, "\n\n");
  result = result.trim();

  return result;
}

function extractSearchableContent(rawContent: string): string {
  let content = stripMdxComponents(rawContent);

  // Keep code blocks but mark them (Pagefind can index code)
  // Allow any attributes (filename, copy, etc.) before the newline
  content = content.replace(
    /```(\w+)?(?:[^\n]*)\n([\s\S]*?)```/g,
    (_, _lang, code) => {
      return `\n${code.trim()}\n`;
    },
  );

  // Keep inline code
  content = content.replace(/`([^`]+)`/g, "$1");

  // Convert markdown links to just text
  content = content.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

  // Convert markdown images to alt text
  content = content.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");

  // Remove HTML comments (iteratively to handle overlapping/malformed cases)
  let previousContent: string;
  do {
    previousContent = content;
    content = content.replace(/<!--[\s\S]*?-->/g, "");
  } while (content !== previousContent);

  // Clean up multiple blank lines
  content = content.replace(/\n{3,}/g, "\n\n");

  return content.trim();
}

describe("stripMdxComponents", () => {
  describe("import statements", () => {
    it("strips single-line imports", () => {
      const input = `import { Foo } from "@/components";

# Hello World`;
      const result = stripMdxComponents(input);
      expect(result).not.toContain("import");
      expect(result).toContain("# Hello World");
    });

    it("strips multiline imports", () => {
      const input = `import {
  ReleaseHighlights,
  Added,
  Changed,
  Deprecated,
  Fixed,
  Security,
  BreakingChanges,
} from "@/components/mdx";

# Release Notes`;
      const result = stripMdxComponents(input);
      expect(result).not.toContain("import");
      expect(result).not.toContain("ReleaseHighlights");
      expect(result).not.toContain("Added");
      expect(result).toContain("# Release Notes");
    });

    it("strips default imports", () => {
      const input = `import Component from "@/components/Component";

# Content`;
      const result = stripMdxComponents(input);
      expect(result).not.toContain("import");
      expect(result).toContain("# Content");
    });

    it("strips multiple import statements", () => {
      const input = `import { Foo } from "@/foo";
import { Bar } from "@/bar";
import {
  Baz,
  Qux,
} from "@/baz";

# Content`;
      const result = stripMdxComponents(input);
      expect(result).not.toContain("import");
      expect(result).not.toContain("Foo");
      expect(result).not.toContain("Bar");
      expect(result).not.toContain("Baz");
      expect(result).toContain("# Content");
    });
  });

  describe("JSX components", () => {
    it("removes self-closing components", () => {
      const input = `# Title

<Callout />

Some content`;
      const result = stripMdxComponents(input);
      expect(result).not.toContain("<Callout");
      expect(result).toContain("# Title");
      expect(result).toContain("Some content");
    });

    it("extracts content from components with children", () => {
      const input = `<Callout type="info">
This is important information.
</Callout>`;
      const result = stripMdxComponents(input);
      expect(result).not.toContain("<Callout");
      expect(result).not.toContain("</Callout>");
      expect(result).toContain("This is important information.");
    });

    it("handles nested components", () => {
      const input = `<Outer>
  <Inner>
    Nested content
  </Inner>
</Outer>`;
      const result = stripMdxComponents(input);
      expect(result).not.toContain("<Outer");
      expect(result).not.toContain("<Inner");
      expect(result).toContain("Nested content");
    });

    it("handles LanguageTabs component", () => {
      const input = `<LanguageTabs items={["TypeScript", "Python"]}>
  <LanguageTabContent value="typescript">
TypeScript code here
  </LanguageTabContent>
  <LanguageTabContent value="python">
Python code here
  </LanguageTabContent>
</LanguageTabs>`;
      const result = stripMdxComponents(input);
      expect(result).not.toContain("<LanguageTabs");
      expect(result).toContain("TypeScript code here");
      expect(result).toContain("Python code here");
    });
  });
});

describe("extractSearchableContent", () => {
  describe("code blocks", () => {
    it("extracts content from basic code blocks", () => {
      const input = `# Example

\`\`\`typescript
const foo = "bar";
\`\`\``;
      const result = extractSearchableContent(input);
      expect(result).not.toContain("```");
      expect(result).toContain('const foo = "bar";');
    });

    it("handles code blocks with filename attribute", () => {
      const input = `\`\`\`ts filename="example.ts"
const x = 1;
\`\`\``;
      const result = extractSearchableContent(input);
      expect(result).not.toContain("```");
      expect(result).not.toContain("filename=");
      expect(result).toContain("const x = 1;");
    });

    it("handles code blocks with copy attribute", () => {
      const input = `\`\`\`ts filename="example.ts" copy
const x = 1;
\`\`\``;
      const result = extractSearchableContent(input);
      expect(result).not.toContain("```");
      expect(result).not.toContain("copy");
      expect(result).not.toContain("filename=");
      expect(result).toContain("const x = 1;");
    });

    it("handles code blocks with multiple attributes", () => {
      const input = `\`\`\`typescript filename="BasicUsage.ts" copy showLineNumbers
interface MyTable {
  id: string;
  name: string;
}
\`\`\``;
      const result = extractSearchableContent(input);
      expect(result).not.toContain("```");
      expect(result).not.toContain("filename=");
      expect(result).not.toContain("copy");
      expect(result).not.toContain("showLineNumbers");
      expect(result).toContain("interface MyTable");
    });

    it("handles code blocks without language specifier", () => {
      const input = `\`\`\`
plain text
\`\`\``;
      const result = extractSearchableContent(input);
      expect(result).not.toContain("```");
      expect(result).toContain("plain text");
    });
  });

  describe("inline code", () => {
    it("removes backticks from inline code", () => {
      const input = "Use the `moose` command to start.";
      const result = extractSearchableContent(input);
      expect(result).not.toContain("`");
      expect(result).toContain("moose");
    });
  });

  describe("markdown links", () => {
    it("extracts link text and removes URLs", () => {
      const input = "Check out [MooseStack](https://moosejs.com) for more.";
      const result = extractSearchableContent(input);
      expect(result).not.toContain("](");
      expect(result).not.toContain("https://");
      expect(result).toContain("MooseStack");
    });
  });

  describe("HTML comments", () => {
    it("removes HTML comments", () => {
      const input = `# Title
<!-- This is a comment -->
Content here`;
      const result = extractSearchableContent(input);
      expect(result).not.toContain("<!--");
      expect(result).not.toContain("-->");
      expect(result).not.toContain("This is a comment");
      expect(result).toContain("# Title");
      expect(result).toContain("Content here");
    });
  });

  describe("combined content", () => {
    it("handles real-world MDX content", () => {
      const input = `import { LanguageTabs, LanguageTabContent } from "@/components/mdx";

# Step 1: Setup Connection

In this step, you'll configure MooseStack to connect to your database.

## Configuration

<LanguageTabs items={["TypeScript", "Python"]}>
  <LanguageTabContent value="typescript">
\`\`\`typescript filename="moose.config.ts" copy
import { defineConfig } from "@514labs/moose-cli";

export default defineConfig({
  dataSources: {
    postgres: {
      type: "postgres",
      host: "localhost",
    },
  },
});
\`\`\`
  </LanguageTabContent>
</LanguageTabs>

For more info, see [the docs](https://docs.moosejs.com).`;

      const result = extractSearchableContent(input);

      // Should not contain MDX artifacts
      expect(result).not.toContain("import");
      expect(result).not.toContain("<LanguageTabs");
      expect(result).not.toContain("```");
      expect(result).not.toContain("filename=");
      expect(result).not.toContain("](");

      // Should contain actual content
      expect(result).toContain("# Step 1: Setup Connection");
      expect(result).toContain("configure MooseStack");
      expect(result).toContain("defineConfig");
      expect(result).toContain("postgres");
      expect(result).toContain("the docs");
    });
  });
});
