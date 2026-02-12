"use client";

import React, { ReactNode, useState, useEffect } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FullPageCustomizer } from "./full-page-customizer";
import { SettingsSummary } from "./settings-summary";

interface CustomizePanelProps {
  /** Panel title (default: "Customize") */
  title?: string;
  /** Panel description text */
  description?: string;
  /** Panel contents (SelectFields, CheckboxGroups, etc.) */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Display mode: inline (default) or wizard (full-page first-time experience) */
  mode?: "inline" | "wizard";
  /** Field IDs to check for existing selections (required for wizard mode) */
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
 * CustomizePanel - A styled container for guide customization options.
 *
 * Supports two modes:
 * - "inline" (default): Always shows as a card in the content flow
 * - "wizard": Shows full-page customizer on first visit, then compact summary
 *
 * @example
 * ```tsx
 * // Inline mode (default)
 * <CustomizePanel title="Customize">
 *   <SelectField ... />
 * </CustomizePanel>
 *
 * // Wizard mode (first-time experience)
 * <CustomizePanel
 *   mode="wizard"
 *   fieldIds={["source-database", "os", "language"]}
 *   fieldLabels={{ "source-database": "Database", "os": "OS" }}
 * >
 *   <SelectField id="source-database" ... />
 *   <SelectField id="os" ... />
 * </CustomizePanel>
 * ```
 */
export function CustomizePanel({
  title = "Customize",
  description,
  children,
  className,
  mode = "inline",
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
    if (mode === "wizard" && fieldIds.length > 0) {
      const existingSelections = getSelections(fieldIds);
      setSelections(existingSelections);
      setShowCustomizer(!existingSelections); // Show customizer if no selections
    }
  }, [mode, fieldIds]);

  // Inline mode - render traditional card
  if (mode === "inline") {
    return (
      <Card
        className={cn(
          "my-6 bg-muted/50 dark:bg-zinc-900/50 border-border/50",
          className,
        )}
      >
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold">{title}</CardTitle>
          {description && (
            <CardDescription className="text-muted-foreground">
              {description}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-6">{children}</CardContent>
      </Card>
    );
  }

  // Wizard mode - handle first-time vs returning user
  if (!isClient) {
    // SSR/initial render - show nothing to avoid hydration mismatch
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
        canContinue={true} // Allow continue even if not all fields set (user can use defaults)
        className={className}
      >
        {children}
      </FullPageCustomizer>
    );
  }

  // Has selections - show summary
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
