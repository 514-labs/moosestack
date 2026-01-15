# Content Components

This directory contains reusable MDX content components that can be included in multiple documentation pages.

## Purpose

Content components allow you to:
- Reuse common content across multiple guides
- Maintain consistency in prerequisites, patterns, and boilerplate sections
- Update shared content in one place and have it reflect everywhere it's used
- Keep individual guide files focused and concise

## Directory Structure

```
shared/
├── prerequisites/    # Common prerequisites (installation, setup)
├── patterns/         # Code patterns and best practices
├── sections/         # Reusable documentation sections
└── examples/         # Example components demonstrating features (including nested examples)
```

## Usage

### Including a Content Component

Use the `:::include` directive followed by the path relative to `/content/shared/`:

```mdx
:::include /shared/prerequisites/install-moose.mdx
```

**Important:** The path must start from `/shared/` within the content directory.

### Example

```mdx
---
title: My Guide
description: A guide that uses shared content
---

# My Guide

:::include /shared/prerequisites/install-moose.mdx

## Getting Started

Now let's build something...
```

At build time, the include directive will be replaced with the full content from `install-moose.mdx`.

## Creating New Content Components

### Guidelines

1. **One purpose per component** - Each component should cover a single, cohesive topic
2. **No frontmatter** - Content components should not have YAML frontmatter (it will be stripped)
3. **Self-contained** - Components should make sense when included in different contexts
4. **Use MDX components** - Feel free to use any of the existing MDX components (Callout, CodeSnippet, etc.)
5. **Language support** - Use LanguageTabs for multi-language content

### Example Content Component

```mdx
## Setting Up Your Database

<Callout type="info">
This step requires Docker Desktop to be running.
</Callout>

Run the following command to start ClickHouse:

\`\`\`bash
moose db start
\`\`\`
```

## Nesting

Content components can include other content components up to 3 levels deep:

```mdx
<!-- /shared/sections/full-setup.mdx -->
:::include /shared/prerequisites/install-moose.mdx
:::include /shared/patterns/init-project.mdx
```

**Warning:** Avoid circular dependencies (A includes B, B includes A). The system will detect and prevent infinite loops.

## Current Components

### Prerequisites
- `install-moose.mdx` - Moose CLI installation instructions for TypeScript and Python
- `node-docker.mdx` - Node.js and Docker Desktop prerequisites

### Patterns
- `data-models.mdx` - How to define data models in TypeScript/Python

### Sections
- `troubleshooting.mdx` - Common troubleshooting steps

### Examples (for testing and demonstration)
- `level-1-component.mdx` - Demonstrates 3-level deep nesting (includes level-2)
- `level-2-component.mdx` - Mid-level component (includes level-3)
- `level-3-component.mdx` - Deepest level component (no includes)
- `combined-example.mdx` - Combines multiple components (includes setup + code-snippet)
- `setup-example.mdx` - Example setup steps
- `code-snippet-example.mdx` - Example code snippet with language tabs

## Best Practices

### When to Create a Component

Create a content component when:
- The same content appears (or will appear) in 3+ guides
- The content represents a reusable prerequisite or setup step
- You want to maintain consistency across multiple guides

### When NOT to Create a Component

Don't create a component when:
- The content is highly specific to one guide
- The content changes frequently based on context
- The content is very short (1-2 sentences)

### Naming Conventions

- Use kebab-case: `install-moose.mdx`, `data-models.mdx`
- Be descriptive: Filename should clearly indicate the content
- Use `.mdx` extension even if no JSX is used (for consistency)

## Search Indexing

Content components in `/shared/` are:
- ✅ Included in the search index when referenced by pages
- ❌ NOT indexed as standalone pages
- ❌ NOT visible in the navigation menu

The search will find the content within the pages that include it.

## Technical Details

### How It Works

1. **Build Time**: When a page is built, `parseMarkdownContent()` in `src/lib/content.ts` processes all `:::include` directives
2. **String Replacement**: The directive is replaced with the file content (frontmatter stripped)
3. **Recursive Processing**: Included files are also scanned for includes (up to 3 levels)
4. **MDX Compilation**: The final merged content is passed to MDXRemote for rendering

### Error Handling

If an include fails, you'll see an error message in place of the content:

- `⚠️ Error: File not found: /shared/path/file.mdx`
- `⚠️ Error: Circular dependency detected for /shared/path/file.mdx`
- `⚠️ Error: Failed to include /shared/path/file.mdx`

Check the build logs for more details.

## Contributing

When adding new content components:

1. Place them in the appropriate subdirectory
2. Test the include in at least one guide
3. Run `pnpm build` to verify no errors
4. Update this README with the new component

## Questions?

For questions or suggestions about the content component system, reach out to the team or create an issue.
