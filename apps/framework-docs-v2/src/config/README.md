# Guide Settings Configuration

## Adding a New Setting

To add a new global guide setting that appears across all guides, just add an entry to `guide-settings-config.ts`:

```typescript
{
  id: "deployment",
  label: "Deployment Platform",
  options: [
    { value: "vercel", label: "Vercel" },
    { value: "aws", label: "AWS" },
    { value: "docker", label: "Docker" },
  ],
  defaultValue: "vercel",
  description: "Your preferred deployment platform",
  visible: true, // Set to false to hide from UI
}
```

That's it! The setting will automatically:
- ✅ Appear in the customizer modal
- ✅ Be saved to localStorage
- ✅ Show in the settings summary panel
- ✅ Have proper TypeScript types
- ✅ Be validated on load
- ✅ Be included in "clear settings" operations

## Setting Configuration

Each setting has these fields:

- **`id`** (required): Unique identifier, used as storage key
- **`label`** (required): Display name in the UI
- **`options`** (required): Array of `{ value, label }` options
- **`defaultValue`** (required): Default value (must match one of the option values)
- **`description`** (optional): Help text/placeholder
- **`visible`** (optional): Whether to show in UI (default: true)

## Using Settings in MDX

### Access current settings:
```tsx
import { useGuideSettings } from "@/contexts/guide-settings-context";

const { settings } = useGuideSettings();

// Check a specific setting
if (settings?.language === "python") {
  // Show Python-specific content
}
```

### Conditional content based on settings:
```mdx
<ConditionalContent when={{ language: "typescript" }}>
  TypeScript-specific instructions here
</ConditionalContent>

<ConditionalContent when={{ language: "python" }}>
  Python-specific instructions here
</ConditionalContent>
```

## Hiding/Showing Settings

To temporarily hide a setting without removing it:
```typescript
{
  id: "experimental-feature",
  // ... other config
  visible: false, // Won't show in UI, but can still be set programmatically
}
```

This is useful for:
- Phasing out deprecated settings gradually
- Testing new settings with a subset of users
- Settings that will be used in future guides

## Architecture

All guide settings are:
- **Stored individually** in localStorage as `moose-docs-guide-settings-{id}`
- **Typed automatically** from the config array
- **Validated on load** to ensure values match allowed options
- **Synced across tabs** via localStorage events
- **Global by default** (not tied to specific pages)

The single config file (`guide-settings-config.ts`) generates:
- TypeScript types (`GuideSettings`, `GuideSettingId`)
- Helper maps (`GUIDE_SETTINGS_BY_ID`, `GUIDE_SETTINGS_LABELS`, etc.)
- Validation functions
- UI components (via `GlobalGuideCustomizer`)
