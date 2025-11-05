# Framework Docs v2

Custom-built documentation site for MooseStack using Next.js 15, Pagefind search, and shadcn components.

## Features

- 📚 Language-specific documentation (TypeScript & Python)
- 🔍 Fast static search with Pagefind
- 🎨 Modern UI with shadcn components
- 📊 Analytics with PostHog and custom instrumentation
- 🧪 Automated code snippet testing
- 🤖 Auto-generated llms.txt for AI assistants
- 🗺️ Auto-generated navigation and TOC

## Development

```bash
# Install dependencies
pnpm install

# Run development server
pnpm dev

# Build for production
pnpm build

# Test code snippets
pnpm test:snippets
```

## Structure

- `/src/app/typescript` - TypeScript documentation
- `/src/app/python` - Python documentation
- `/content` - Markdown content files
- `/src/components` - React components
- `/src/lib` - Utility functions and content processing
