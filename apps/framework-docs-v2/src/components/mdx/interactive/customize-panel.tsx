"use client";

import React, { ReactNode, useState, useEffect, useMemo } from "react";
import { FullPageCustomizer } from "./full-page-customizer";
import { SettingsSummary } from "./settings-summary";
import {
  STORAGE_KEY_PREFIX_PAGE,
  STORAGE_KEY_PREFIX_GLOBAL,
} from "./use-persisted-state";
import { getSetting, GuideSettings } from "@/lib/guide-settings";

/**
 * Normalize field ID to match GuideSettings interface keys
 * Converts kebab-case to camelCase for compatibility with global settings
 */
function normalizeFieldId(fieldId: string): keyof GuideSettings | null {
  const normalized = fieldId.replace(/-([a-z])/g, (_, letter) =>
    letter.toUpperCase(),
  );

  const validKeys: (keyof GuideSettings)[] = [
    "language",
    "os",
    "sourceDatabase",
    "monorepo",
    "existingApp",
  ];

  return validKeys.includes(normalized as keyof GuideSettings) ?
      (normalized as keyof GuideSettings)
    : null;
}

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
        selections[fieldId] = JSON.parse(urlValue);
        hasAny = true;
      } catch {
        selections[fieldId] = urlValue;
        hasAny = true;
      }
      continue;
    }

    // Fall back to localStorage - check both page and global storage
    try {
      // Check page-level storage (uses field ID as-is)
      const pageKey = `${STORAGE_KEY_PREFIX_PAGE}-${fieldId}`;
      let stored = localStorage.getItem(pageKey);

      // Check global storage (may need field ID normalization)
      if (!stored) {
        const normalizedKey = normalizeFieldId(fieldId);
        if (normalizedKey) {
          const globalValue = getSetting(normalizedKey);
          if (globalValue !== null && globalValue !== undefined) {
            selections[fieldId] = globalValue;
            hasAny = true;
            continue;
          }
        }

        // Fallback: check global storage with kebab-case key
        const globalKey = `${STORAGE_KEY_PREFIX_GLOBAL}-${fieldId}`;
        stored = localStorage.getItem(globalKey);
      }

      if (stored) {
        selections[fieldId] = JSON.parse(stored);
        hasAny = true;
      }
    } catch {
      // Ignore errors
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
}: CustomizePanelProps): React.JSX.Element {
  const [showCustomizer, setShowCustomizer] = useState(false);
  const [selections, setSelections] = useState<Record<string, string> | null>(
    null,
  );
  const [isClient, setIsClient] = useState(false);

  // Stabilize fieldIds to avoid unnecessary re-runs when array reference changes
  const fieldIdsKey = useMemo(() => fieldIds?.join(",") || "", [fieldIds]);

  // Check for existing selections on mount
  useEffect(() => {
    setIsClient(true);
    if (fieldIdsKey) {
      const ids = fieldIdsKey.split(",");
      const existingSelections = getSelections(ids);
      setSelections(existingSelections);
      setShowCustomizer(!existingSelections); // Show customizer if no selections
    }
  }, [fieldIdsKey]); // Depend on stringified version, not array reference

  // SSR/initial render - show nothing to avoid hydration mismatch
  if (!isClient) {
    return <div className="min-h-[60vh]" />;
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
          // Dismiss customizer - check selections to avoid empty state
          const currentSelections = getSelections(fieldIds);
          if (currentSelections) {
            setSelections(currentSelections);
            setShowCustomizer(false);
          } else {
            // If no selections exist, keep customizer open (user must configure)
            // Alternatively, could set some defaults here
            setShowCustomizer(true);
          }
        }}
        canContinue={true} // Allow continue even if not all fields set (user can use defaults)
      >
        {children}
      </FullPageCustomizer>
    );
  }

  // Has selections - show summary in bottom-left
  if (selections) {
    return (
      <SettingsSummary
        selections={selections}
        labels={fieldLabels}
        onChangeSettings={() => setShowCustomizer(true)}
        className={className}
      />
    );
  }

  // Fallback - shouldn't reach here
  return <div className="min-h-[60vh]" />;
}
