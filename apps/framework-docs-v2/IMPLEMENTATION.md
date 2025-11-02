# Framework Docs v2 - Implementation Summary

## Overview

A custom-built documentation site for MooseStack using Next.js 15, featuring language-specific documentation (TypeScript & Python), full-text search with Pagefind, and comprehensive analytics.

## Completed Implementation

### ✅ Phase 1: Project Setup and Configuration

- **Next.js 15 App** with TypeScript configuration
- **Dependencies configured**:
  - Next.js 15, React 19
  - Pagefind for search
  - shadcn/ui components (@radix-ui/*)
  - posthog-js for analytics
  - MDX/markdown processing (gray-matter, remark, rehype)
  - Testing utilities (vitest)
- **Monorepo integration**: Already configured in pnpm-workspace.yaml and turbo.json
- **Build system**: Standard Next.js SSG with `generateStaticParams`

### ✅ Phase 2: Core Architecture

**Directory Structure Created:**
```
apps/framework-docs-v2/
├── src/
│   ├── app/
│   │   ├── layout.tsx (root layout with Pagefind loader)
│   │   ├── page.tsx (redirects to /typescript)
│   │   ├── typescript/
│   │   │   ├── layout.tsx (with nav + analytics)
│   │   │   ├── page.tsx (index page)
│   │   │   └── [...slug]/page.tsx (dynamic doc pages)
│   │   ├── python/
│   │   │   ├── layout.tsx (with nav + analytics)
│   │   │   ├── page.tsx (index page)
│   │   │   └── [...slug]/page.tsx (dynamic doc pages)
│   │   └── api/
│   │       └── llms.txt/route.ts (LLM text generation)
│   ├── components/
│   │   ├── ui/ (shadcn components)
│   │   │   ├── button.tsx
│   │   │   ├── separator.tsx
│   │   │   ├── collapsible.tsx
│   │   │   ├── navigation-menu.tsx
│   │   │   ├── accordion.tsx
│   │   │   └── dialog.tsx
│   │   ├── navigation/
│   │   │   ├── top-nav.tsx (MooseStack, Hosting, AI + language switcher)
│   │   │   ├── side-nav.tsx (auto-generated from content)
│   │   │   └── toc-nav.tsx (table of contents + helpful links)
│   │   ├── search/
│   │   │   ├── search-bar.tsx (Pagefind integration with Cmd+K)
│   │   │   └── pagefind-loader.tsx (script loader)
│   │   └── analytics-provider.tsx (PostHog + custom tracking)
│   ├── lib/
│   │   ├── content.ts (markdown parsing, nav generation, TOC)
│   │   ├── analytics.ts (PostHog + custom wrapper SDK)
│   │   ├── llms-generator.ts (auto-generate llms.txt)
│   │   ├── snippet-tester.ts (validate code snippets)
│   │   └── cn.ts (utility for className merging)
│   └── styles/
│       └── globals.css (with prose styles)
├── content/
│   ├── typescript/
│   │   └── quickstart.md (sample content)
│   └── python/
│       └── quickstart.md (sample content)
├── scripts/
│   ├── migrate-content.ts (migration from framework-docs)
│   └── test-snippets.ts (extract & test code blocks)
└── tests/
    └── snippets/ (automated snippet validation)
```

**Content Management System:**
- Markdown parser with frontmatter support (title, description, order, category, helpfulLinks)
- Navigation tree generator from file structure and frontmatter
- TOC generator from markdown headings (h2, h3)
- Support for code block language tagging and testing annotations

### ✅ Phase 3: UI Components

**Top-Level Navigation:**
- Three main items: MooseStack, Hosting (external), AI
- Language switcher (TypeScript/Python) that changes URL base
- Search bar integration with keyboard shortcut (Cmd/Ctrl+K)
- Responsive mobile menu

**Side Navigation:**
- Auto-generated from content directory structure
- Nested categories with collapsible sections
- Active page highlighting
- Scroll position persistence

**Right-Side Navigation (TOC):**
- Generated from h2/h3 headings in current page
- "On this page" section with scroll spy
- "Helpful links" section (configurable via frontmatter)
- External link indicators

**shadcn Components:**
- Button, Separator, Collapsible, Navigation Menu, Accordion, Dialog
- All configured with proper theming and accessibility

### ✅ Phase 4: Search with Pagefind

**Integration:**
- Pagefind indexes after build via post-build script
- Search UI component using shadcn Dialog
- Keyboard shortcuts (Cmd+K / Ctrl+K)
- Both TypeScript and Python content indexed separately
- Language indicator in search results

**Build Process:**
- Post-build script: `pagefind --site .next/server/app --output-path public/pagefind`
- Lazy-loaded via Script component in root layout

### ✅ Phase 5: Analytics and Instrumentation

**PostHog Integration:**
- Provider set up in language-specific layouts
- Tracks: page views, navigation, code copies, search queries
- Debug mode in development

**Custom Metrics SDK Wrapper:**
- Wraps PostHog with custom event types
- Sends to internal endpoint: `https://moosefood.514.dev/ingest/DocsEvent`
- Tracking events:
  - Page views with language context
  - Documentation snippet copies
  - Search queries and result clicks
  - Navigation patterns
  - Session management

**Event Types:**
- `DocsEvent` interface with eventType, language, path, metadata
- Auto-tracks code copying from code blocks
- Non-blocking analytics (won't disrupt UX on failure)

### ✅ Phase 6: Content Migration

**Migration Script (`scripts/migrate-content.ts`):**
- Extracts content from `apps/framework-docs/src/pages/moose/`
- Separates language-specific content (strips `<TypeScript>` and `<Python>` tags)
- Splits into `/content/typescript/` and `/content/python/` directories
- Preserves frontmatter, converts relative links
- Maintains folder structure for navigation consistency
- Cleans MDX components and imports

**Usage:**
```bash
tsx scripts/migrate-content.ts
```

### ✅ Phase 7: llms.txt Generation

**Auto-Generation:**
- API route at `/api/llms.txt?lang=typescript|python`
- Language-specific versions available
- Extracts content, strips MDX components, formats for LLM consumption
- Includes frontmatter metadata (title, description)
- Adds source path references
- Generates table of contents

**Access:**
- `/api/llms.txt?lang=typescript` - TypeScript docs only
- `/api/llms.txt?lang=python` - Python docs only
- Default serves TypeScript

### ✅ Phase 8: Code Snippet Testing

**Test Infrastructure:**
- Snippet extraction utility parses code blocks with language annotations
- Looks for test directive comments (e.g., `@test`)
- Generates validation results

**Automated Validation:**
- Run via: `pnpm test:snippets`
- TypeScript snippets: syntax validation (brace matching, etc.)
- Python snippets: indentation validation (tabs vs spaces)
- Reports errors with file/line references
- Can be integrated into build process

**Integration:**
- Added to `turbo.json` as `test:snippets` task
- Can run before or during static generation

### ✅ Phase 9: Build Configuration

**Next.js Configuration:**
- Standard SSG with `generateStaticParams` for all doc pages
- Rewrites for PostHog proxy (/ingest/*)
- Image optimization enabled
- Environment variables for PostHog configured

**Build Scripts (package.json):**
```json
{
  "dev": "next dev",
  "build": "next build && pnpm run index:search",
  "index:search": "pagefind --site .next/server/app --output-path public/pagefind",
  "test:snippets": "tsx scripts/test-snippets.ts"
}
```

## Environment Variables

Create `.env.local`:
```bash
NEXT_PUBLIC_POSTHOG_KEY=your_posthog_key
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
SITE_URL=https://docs.moosestack.com
```

## Next Steps

1. **Run Content Migration:**
   ```bash
   cd apps/framework-docs-v2
   pnpm install
   tsx scripts/migrate-content.ts
   ```

2. **Review and Fix Content:**
   - Check migrated content in `content/typescript/` and `content/python/`
   - Fix any broken links or formatting issues
   - Update image paths if necessary

3. **Build and Test:**
   ```bash
   pnpm build
   pnpm start
   ```

4. **Test Snippets:**
   ```bash
   pnpm test:snippets
   ```

5. **Deploy:**
   - Configure environment variables on hosting platform
   - Push to repository
   - Vercel will auto-deploy on push to main

## Key Features Implemented

✅ Language-specific URLs (`/typescript/*` and `/python/*`)
✅ Auto-generated navigation from content structure
✅ Auto-generated table of contents from headings
✅ Full-text search with Pagefind
✅ Keyboard shortcuts (Cmd+K)
✅ PostHog analytics integration
✅ Custom metrics to internal Moose endpoint
✅ Code copy tracking
✅ Search query tracking
✅ Migration script for existing content
✅ llms.txt auto-generation
✅ Code snippet testing framework
✅ Static site generation
✅ Responsive design (mobile, tablet, desktop)
✅ shadcn/ui components
✅ TypeScript throughout
✅ Monorepo integration

## Architecture Decisions

1. **No `output: 'export'`**: Using standard Next.js SSG to keep API routes available for dynamic llms.txt generation
2. **Separate URLs for languages**: `/typescript/*` and `/python/*` for better SEO and navigation
3. **File-based content**: Markdown files in `/content` directory for easy editing
4. **Auto-generated nav**: Navigation structure derived from file system and frontmatter
5. **Client-side search**: Pagefind provides fast, static search without server
6. **Dual analytics**: PostHog for general analytics + custom endpoint for Moose-specific tracking

## Testing

Sample content created in:
- `content/typescript/quickstart.md`
- `content/python/quickstart.md`

To test the site:
```bash
cd apps/framework-docs-v2
pnpm install
pnpm dev
```

Visit: http://localhost:3000

## Maintenance

- **Adding new docs**: Create markdown files in `content/typescript/` or `content/python/`
- **Updating navigation**: Modify frontmatter `order` and `category` fields
- **Adding helpful links**: Use frontmatter `helpfulLinks` array
- **Testing snippets**: Run `pnpm test:snippets` before deploying
- **Updating analytics**: Modify `src/lib/analytics.ts`
