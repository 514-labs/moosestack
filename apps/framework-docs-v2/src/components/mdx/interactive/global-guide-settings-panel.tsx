"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { useGuideSettings } from "@/contexts/guide-settings-context";
import { GlobalGuideCustomizer } from "./global-guide-customizer";
import { SettingsSummary } from "./settings-summary";

const FIELD_LABELS: Record<string, string> = {
  language: "Language",
  os: "OS",
  sourceDatabase: "Database",
  monorepo: "Monorepo",
  existingApp: "Existing app",
};

// Map raw values to display labels
const VALUE_LABELS: Record<string, Record<string, string>> = {
  language: {
    typescript: "TypeScript",
    python: "Python",
  },
  os: {
    macos: "macOS",
    windows: "Windows",
  },
  sourceDatabase: {
    postgres: "Postgres",
    sqlserver: "SQL Server",
    none: "None",
  },
  monorepo: {
    yes: "Monorepo",
    no: "Single repo",
  },
  existingApp: {
    yes: "Existing app",
    no: "New app",
  },
};

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

  // Don't show panel on guides index page
  if (pathname === "/guides") {
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
    const displayValue = VALUE_LABELS[key]?.[value] || value;
    filteredSelections[key] = displayValue;
  });

  return (
    <SettingsSummary
      selections={filteredSelections}
      labels={FIELD_LABELS}
      onChangeSettings={() => setShowCustomizer(true)}
      heading="Your Stack"
      buttonText="Configure"
    />
  );
}
