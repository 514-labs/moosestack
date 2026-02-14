"use client";

import React, { ReactNode, useState, useEffect, useMemo } from "react";
import { FullPageCustomizer } from "./full-page-customizer";
import { SettingsSummary } from "./settings-summary";
import {
  STORAGE_KEY_PREFIX_PAGE,
  STORAGE_KEY_PREFIX_GLOBAL,
} from "./use-persisted-state";
import { getSetting, normalizeFieldId } from "@/lib/guide-settings";
import { useGuideSettings } from "@/contexts/guide-settings-context";

interface CustomizePanelProps {
  /** Panel title (default: "Customize this tutorial") */
  title?: string;
  /** Panel description text */
  description?: string;
  /** Panel contents (SelectFields, CheckboxGroups, etc.) */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Field IDs to check for existing selections */
  fieldIds?: string[];
  /** Labels for fields to show in settings summary */
  fieldLabels?: Record<string, string>;
}

/**
 * Get current selections from URL params or localStorage
 * Batch-read multiple fields at once for checking if wizard should show
 *
 * Note: Uses same storage pattern as usePersistedState for consistency.
 * Checks both page-level and global storage.
 */
function getSelections(fieldIds: string[]): Record<string, string> | null {
  if (typeof window === "undefined") return null;

  const selections: Record<string, string> = {};
  let hasAny = false;

  // Check URL params first
  const params = new URLSearchParams(window.location.search);

  for (const fieldId of fieldIds) {
    // Try URL first
    const urlValue = params.get(fieldId);
    if (urlValue) {
      try {
        const parsed = JSON.parse(urlValue);
        // Only store if it's a string value
        if (typeof parsed === "string") {
          selections[fieldId] = parsed;
          hasAny = true;
        }
      } catch {
        // If JSON parse fails, use raw string value
        selections[fieldId] = urlValue;
        hasAny = true;
      }
      continue;
    }

    // Fall back to localStorage - prioritize page-level, then global
    try {
      // Priority 1: Check page-level storage (allows per-page overrides)
      const pageKey = `${STORAGE_KEY_PREFIX_PAGE}-${fieldId}`;
      const pageStored = localStorage.getItem(pageKey);

      if (pageStored) {
        const parsed = JSON.parse(pageStored);
        // Only store if it's a string value
        if (typeof parsed === "string") {
          selections[fieldId] = parsed;
          hasAny = true;
          continue;
        }
      }

      // Priority 2: Check global storage (fallback to user's global preferences)
      const normalizedKey = normalizeFieldId(fieldId);
      if (normalizedKey) {
        const globalValue = getSetting(normalizedKey);
        if (globalValue !== null && globalValue !== undefined) {
          selections[fieldId] = globalValue;
          hasAny = true;
          continue;
        }
      }

      // Priority 3: Check global storage with raw kebab-case key (legacy support)
      const globalKey = `${STORAGE_KEY_PREFIX_GLOBAL}-${fieldId}`;
      const globalStored = localStorage.getItem(globalKey);

      if (globalStored) {
        const parsed = JSON.parse(globalStored);
        // Only store if it's a string value
        if (typeof parsed === "string") {
          selections[fieldId] = parsed;
          hasAny = true;
        }
      }
    } catch {
      // Ignore parsing errors - silently skip invalid values
    }
  }

  return hasAny ? selections : null;
}

/**
 * CustomizePanel - Wizard-style guide customization with persistent settings
 *
 * Shows a full-page modal on first visit for configuration, then displays
 * a compact bottom-left summary panel with the selected options.
 *
 * @example
 * ```tsx
 * <CustomizePanel
 *   title="Customize this tutorial"
 *   description="Select your environment to see relevant instructions"
 *   fieldIds={["source-database", "os", "language"]}
 *   fieldLabels={{ "source-database": "Database", "os": "OS", "language": "Language" }}
 * >
 *   <SelectField id="source-database" ... />
 *   <SelectField id="os" ... />
 *   <SelectField id="language" ... />
 * </CustomizePanel>
 * ```
 */
export function CustomizePanel({
  title = "Customize this tutorial",
  description,
  children,
  className,
  fieldIds = [],
  fieldLabels = {},
}: CustomizePanelProps): React.JSX.Element | null {
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [selections, setSelections] = useState<Record<string, string> | null>(
    null,
  );
  const [isClient, setIsClient] = useState(false);

  // Get global customizer state to avoid overlapping dialogs
  const guideSettings = useGuideSettings?.() || {
    showCustomizer: false,
    isConfigured: false,
    settings: null,
    setShowCustomizer: () => {},
  };

  // Stabilize fieldIds to avoid unnecessary re-runs when array reference changes
  const fieldIdsKey = useMemo(() => fieldIds?.join(",") || "", [fieldIds]);

  // Check for existing selections on mount
  useEffect(() => {
    setIsClient(true);
    if (fieldIdsKey) {
      const ids = fieldIdsKey.split(",");
      const existingSelections = getSelections(ids);
      setSelections(existingSelections);
      // Only show customizer if:
      // 1. No selections exist (neither page-level nor global)
      // 2. Global customizer is not currently showing (prevents overlap)
      setShowCustomizer(!existingSelections && !guideSettings.showCustomizer);
    }
  }, [fieldIdsKey, guideSettings.showCustomizer]); // Also depend on global customizer state

  // SSR/initial render - show nothing to avoid hydration mismatch
  if (!isClient) {
    return null;
  }

  // No fieldIds configured - render children directly (no customization needed)
  if (!fieldIds || fieldIds.length === 0) {
    return <div className={className}>{children}</div>;
  }

  // Show full-page customizer if no selections or user clicked "Change"
  if (showCustomizer) {
    return (
      <FullPageCustomizer
        title={title}
        description={description}
        onContinue={() => {
          // Re-check selections after user makes changes
          const newSelections = getSelections(fieldIds);
          setSelections(newSelections);
          // Only close if selections exist, otherwise keep customizer open
          if (newSelections) {
            setShowCustomizer(false);
          }
        }}
        onClose={() => {
          // Allow dismissal even without selections
          const currentSelections = getSelections(fieldIds);
          setSelections(currentSelections);
          setShowCustomizer(false);
        }}
        canContinue={true} // Allow continue even if not all fields set (user can use defaults)
      >
        {children}
      </FullPageCustomizer>
    );
  }

  // Has selections - show summary in bottom-left
  if (selections && Object.keys(selections).length > 0) {
    return (
      <SettingsSummary
        selections={selections}
        labels={fieldLabels}
        onChangeSettings={() => setShowCustomizer(true)}
        className={className}
      />
    );
  }

  // No selections - user dismissed customizer, show nothing (they can use defaults)
  return null;
}
