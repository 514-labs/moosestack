# Writing and Publishing Guides

This document explains how to create, manage, and promote guides in the MooseStack documentation.

## Guide Visibility Levels

Guides go through three visibility stages:

| Status | Who Can See | Use Case |
|--------|-------------|----------|
| **Draft** (`status: "draft"`) | Internal team with `show-draft-guides` flag | Work-in-progress, not ready for anyone external |
| **Beta** (`status: "beta"`) | Select users with `show-beta-guides` flag | Ready for external preview (e.g., ClickHouse sales team) |
| **Public** (no status) | Everyone | Fully published and ready for all users |

### Viewing Hidden Guides

Use the Vercel Toolbar (available in preview deployments) to toggle:
- `show-draft-guides` - See all draft guides
- `show-beta-guides` - See all beta guides

## Creating a New Guide

### 1. Create the Content File

Create an MDX file in the appropriate location:

```
content/guides/
├── getting-started.mdx              # Top-level guide (no category)
├── applications/                    # Category folder
│   ├── performant-dashboards.mdx   # Guide in "Applications" section
│   └── in-app-chat-analytics.mdx
├── data-management/
│   └── migrations.mdx
└── ...
```

### 2. Add Frontmatter

Every guide needs frontmatter:

```mdx
---
title: Your Guide Title
description: A brief description of what the guide covers
---

# Your Guide Title

Content goes here...
```

### 3. Register in Navigation

Add your guide to `src/config/navigation.ts` in the `guidesNavigationConfig` array:

**For a top-level guide (no category):**

```typescript
const guidesNavigationConfig: NavigationConfig = [
  {
    type: "page",
    slug: "guides/your-guide-name",
    title: "Your Guide Title",
    icon: IconRocket, // Choose from @tabler/icons-react
    languages: ["typescript", "python"],
    status: "draft", // Start as draft
  },
  // ... other guides
];
```

**For a guide in a category:**

```typescript
{
  type: "section",
  title: "Applications",
  items: [
    {
      type: "page",
      slug: "guides/applications/your-guide",
      title: "Your Guide Title",
      icon: IconChartLine,
      languages: ["typescript", "python"],
      status: "draft", // Start as draft
    },
    // ... other guides in this section
  ],
},
```

### 4. Choose an Icon

Import an icon from `@tabler/icons-react` at the top of `navigation.ts`:

```typescript
import {
  IconRocket,
  IconChartLine,
  IconDatabase,
  // ... add your icon here
} from "@tabler/icons-react";
```

Browse available icons at: https://tabler.io/icons

## Promoting a Guide

### Draft → Beta

When a guide is ready for external preview:

```typescript
// Before
{
  type: "page",
  slug: "guides/applications/your-guide",
  title: "Your Guide",
  status: "draft",  // ← Change this
  // ...
}

// After
{
  type: "page",
  slug: "guides/applications/your-guide",
  title: "Your Guide",
  status: "beta",   // ← To this
  // ...
}
```

### Beta → Public

When a guide is fully ready:

```typescript
// Before
{
  type: "page",
  slug: "guides/applications/your-guide",
  title: "Your Guide",
  status: "beta",  // ← Remove this line entirely
  // ...
}

// After
{
  type: "page",
  slug: "guides/applications/your-guide",
  title: "Your Guide",
  // No status = public
  // ...
}
```

## Guide Structure Best Practices

### Simple Guide

A single MDX file is sufficient for straightforward guides:

```
content/guides/applications/your-guide.mdx
```

### Multi-Step Guide

For complex guides with multiple steps, use a folder structure:

```
content/guides/applications/performant-dashboards/
├── guide.toml                    # Guide manifest (for dynamic guides)
├── guide-overview.mdx            # Main overview page
├── existing-oltp-db.mdx          # Starting point variant
└── existing-oltp-db/
    ├── 1-setup-connection.mdx    # Step 1
    └── 2-create-materialized-view.mdx  # Step 2
```

### Dynamic Guides (Advanced)

Dynamic guides use a `guide.toml` manifest for branching paths based on user choices. See existing examples in `content/guides/applications/performant-dashboards/`.

## Categories

Current guide categories (sections in navigation):

- **Applications** - Building apps with Moose (dashboards, chat analytics, reports)
- **Data Management** - Migrations, CDC, impact analysis
- **Data Warehousing** - CDPs, operational analytics, connectors
- **Methodology** - Data-as-code, DORA metrics
- **Strategy** - AI enablement, platform engineering

To add a new category, add a new `type: "section"` entry in `guidesNavigationConfig`.

## Checklist for New Guides

- [ ] Create MDX file with proper frontmatter
- [ ] Add entry to `guidesNavigationConfig` in `src/config/navigation.ts`
- [ ] Set `status: "draft"` initially
- [ ] Choose appropriate icon
- [ ] Test locally with `show-draft-guides` flag enabled
- [ ] Get review, then promote to `status: "beta"` 
- [ ] After beta feedback, promote to public (remove status)

## Current Priority Guides

From the [Linear project](https://linear.app/514/project/ship-the-first-iteration-of-guides-and-test-them-within-our-customers-d3b3d83562d9):

| Guide | File | Status |
|-------|------|--------|
| Improving the Performance of Your Dashboards | `content/guides/performant-dashboards.mdx` | Draft |
| Chat in Your App | `content/guides/chat-in-your-app.mdx` | Draft |
| Customer Data Platform (CDP) | `content/guides/customer-data-platform.mdx` | Draft |
| Static Report Generation | `content/guides/static-report-generation.mdx` | Draft |
| Data Warehouses | `content/guides/data-warehouses.mdx` | Draft |

These are top-level guides (no category) and will appear prominently on the guides page.

## Related Documentation

- `FLAGS_README.md` - Feature flags setup and usage
- `AGENTS.md` (root) - General development guidelines
