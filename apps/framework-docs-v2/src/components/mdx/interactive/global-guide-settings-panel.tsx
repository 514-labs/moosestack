"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useGuideSettings } from "@/contexts/guide-settings-context";
import { GlobalGuideCustomizer } from "./global-guide-customizer";
import { SettingsSummary } from "./settings-summary";
import {
  GUIDE_SETTINGS_LABELS,
  GUIDE_SETTINGS_VALUE_LABELS,
} from "@/lib/guide-settings";

/**
 * GlobalGuideSettingsPanel - Persistent settings panel for guide customization
 *
 * Displays current guide settings in a fixed bottom-left panel.
 * Always visible across all guide pages once configured.
 */
export function GlobalGuideSettingsPanel(): React.JSX.Element | null {
  const pathname = usePathname();
  const { settings, isConfigured, showCustomizer, setShowCustomizer } =
    useGuideSettings();

  // Don't show panel on guides index page (normalize trailing slash)
  const normalizedPath = pathname.replace(/\/$/, ""); // Remove trailing slash
  if (normalizedPath === "/guides") {
    return null;
  }

  // Show customizer modal on first visit
  if (showCustomizer) {
    return (
      <GlobalGuideCustomizer
        open={showCustomizer}
        onClose={() => setShowCustomizer(false)}
      />
    );
  }

  // Don't show panel until configured
  if (!isConfigured || !settings) {
    return null;
  }

  // Filter out unused fields and map values to display labels
  const filteredSelections: Record<string, string> = {};
  Object.entries(settings as Record<string, string>).forEach(([key, value]) => {
    // Skip fields that aren't currently used in guides
    if (key === "monorepo" || key === "existingApp") return;

    // Map value to display label
    const displayValue = GUIDE_SETTINGS_VALUE_LABELS[key]?.[value] || value;
    filteredSelections[key] = displayValue;
  });

  return (
    <SettingsSummary
      selections={filteredSelections}
      labels={GUIDE_SETTINGS_LABELS}
      onChangeSettings={() => setShowCustomizer(true)}
      heading="Your Stack"
      buttonText="Configure"
    />
  );
}
