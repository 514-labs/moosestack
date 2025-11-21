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

## Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```bash
# GitHub API token (optional but recommended)
# Without token: 60 requests/hour rate limit
# With token: 5,000 requests/hour rate limit
GITHUB_TOKEN=your_github_token_here
```

### Creating a GitHub Token

**Option 1: Using GitHub CLI (recommended)**

If you have the GitHub CLI (`gh`) installed and authenticated:

```bash
# Get your current GitHub token
gh auth token

# Or create a new token with specific scopes
gh auth refresh -s public_repo
```

Then add the token to your `.env.local` file.

**Option 2: Using the Web Interface**

1. Go to https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Give it a name (e.g., "Moose Docs")
4. Select the `public_repo` scope (or no scopes needed for public repos)
5. Generate and copy the token
6. Add it to your `.env.local` file

## Structure

- `/src/app/typescript` - TypeScript documentation
- `/src/app/python` - Python documentation
- `/content` - Markdown content files
- `/src/components` - React components
- `/src/lib` - Utility functions and content processing
