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
- `show-draft-guides` - See all draft guides (internal team)
- `show-beta-guides` - See all beta guides (select external users)

**Note:** Draft and beta are mutually exclusive sets. Each flag only reveals its corresponding status level.

## Creating a New Guide

### 1. Create the Content File

Create an MDX file in the appropriate location:

```
content/guides/
├── performant-dashboards.mdx        # Top-level guide (no category)
├── chat-in-your-app.mdx             # Top-level guide
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

## Interactive Components & Settings Architecture

Guides use interactive MDX components (`SelectField`, `CheckboxGroup`, `ConditionalContent`, etc.) that let users customize guide content based on their setup. This section explains how settings flow through the system.

### Data Flow Overview

```
┌─────────────────────┐     localStorage      ┌──────────────────────┐
│  GlobalGuideCustomizer│ ──────────────────► │   ConditionalContent  │
│  (wizard modal)      │  writes per-key:     │   (reads & renders)   │
│                      │  moose-docs-guide-   │                      │
│  SelectField ×N      │  settings-{id}       │  Priority chain:     │
│  persist: global     │                      │  1. Page-level key   │
└─────────────────────┘                      │  2. Global key       │
                                              │  3. Legacy fallback  │
┌─────────────────────┐     localStorage      │                      │
│  Page SelectField    │ ──────────────────► │                      │
│  (inline in MDX)     │  writes per-key:     └──────────────────────┘
│  persist: true       │  moose-docs-
│                      │  interactive-{id}
└─────────────────────┘
```

### Key Concepts

**Two storage namespaces:**
- `moose-docs-guide-settings-{id}` — Global settings (language, os, sourceDatabase). Written by the wizard and shared across all guide pages.
- `moose-docs-interactive-{id}` — Page-level settings (progress checkboxes, page-specific selections). Scoped to individual guide pages.

**The wizard modal** (`GlobalGuideCustomizer` in `global-guide-customizer.tsx`):
- Renders a `SelectField` for each visible setting from `guide-settings-config.ts`
- Uses `persist={{ namespace: "global", syncToUrl: false }}` — writes to global localStorage keys but doesn't touch the URL
- On "Continue", writes defaults for any untouched fields so the wizard doesn't reappear

**ConditionalContent** reads stored values using a priority chain:
1. **Page-level key** (`moose-docs-interactive-{id}`) — allows per-page overrides
2. **Global key** (`moose-docs-guide-settings-{camelCaseId}`) — the wizard's storage
3. **Legacy fallback** — raw key without camelCase normalization

**URL syncing** is config-driven via `syncToUrl: true` in `guide-settings-config.ts`:
- Only settings marked `syncToUrl: true` appear in URL params (currently: language, os, sourceDatabase)
- URL params are only present on `/guides/*` pages — `GlobalGuideSettingsPanel` strips them on non-guide pages
- URL is never the source of truth for reading; localStorage always wins

### Files Involved

| File | Role |
|------|------|
| `src/config/guide-settings-config.ts` | Single source of truth for all global settings (options, defaults, visibility, URL sync) |
| `src/lib/guide-settings.ts` | Read/write helpers for global settings in localStorage |
| `src/contexts/guide-settings-context.tsx` | React context providing settings state and wizard visibility |
| `src/components/mdx/interactive/global-guide-customizer.tsx` | The wizard modal that collects initial settings |
| `src/components/mdx/interactive/global-guide-settings-panel.tsx` | The bottom-left "Your Stack" panel + URL cleanup on non-guide pages |
| `src/components/mdx/interactive/use-persisted-state.ts` | Core hook for localStorage + URL persistence with namespace support |
| `src/components/mdx/interactive/conditional-content.tsx` | Shows/hides MDX content based on stored field values |
| `src/components/mdx/interactive/select-field.tsx` | Dropdown that persists selection to localStorage (and optionally URL) |
| `src/components/mdx/interactive/checkbox-group.tsx` | Checkbox group that persists selections to localStorage |
| `src/components/mdx/interactive/customize-panel.tsx` | Page-level customizer panel with inline settings |

### Adding a New Global Setting

1. Add an entry to `GUIDE_SETTINGS_CONFIG` in `src/config/guide-settings-config.ts`:
   ```typescript
   {
     id: "newSetting",
     label: "Display Label",
     options: [
       { value: "option1", label: "Option 1" },
       { value: "option2", label: "Option 2" },
     ],
     defaultValue: "option1",
     visible: true,        // Show in wizard modal
     showInSummary: true,   // Show in bottom-left panel
     syncToUrl: false,      // Whether to include in URL params on guide pages
   },
   ```
2. That's it — the wizard, summary panel, types, and storage all derive from this config automatically.
3. Use `<ConditionalContent whenId="newSetting" whenValue="option1">` in MDX to show conditional content.

### Same-Tab Reactivity

Components communicate within the same tab via custom events (`INTERACTIVE_STATE_CHANGE_EVENT`), dispatched by `usePersistedState` whenever a value changes. `ConditionalContent` listens for these events to update immediately without waiting for a page reload or `storage` event (which only fires cross-tab).

## Related Documentation

- `FLAGS_README.md` - Feature flags setup and usage
- `AGENTS.md` (root) - General development guidelines
- `src/config/README.md` - Guide settings config reference
- `content/guides/test-guides/interactive-guide-demo.mdx` - Interactive component syntax examples
