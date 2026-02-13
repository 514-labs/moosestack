"use client";

import React, { ReactNode, useState, useEffect } from "react";
import { FullPageCustomizer } from "./full-page-customizer";
import { SettingsSummary } from "./settings-summary";

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

    // Fall back to localStorage
    try {
      const stored = localStorage.getItem(`moose-docs-interactive-${fieldId}`);
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

  // Check for existing selections on mount
  useEffect(() => {
    setIsClient(true);
    if (fieldIds.length > 0) {
      const existingSelections = getSelections(fieldIds);
      setSelections(existingSelections);
      setShowCustomizer(!existingSelections); // Show customizer if no selections
    }
  }, [fieldIds]);

  // SSR/initial render - show nothing to avoid hydration mismatch
  if (!isClient) {
    return <div className="min-h-[60vh]" />;
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
          setShowCustomizer(false);
        }}
        onClose={() => {
          // Dismiss customizer without saving
          setShowCustomizer(false);
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
