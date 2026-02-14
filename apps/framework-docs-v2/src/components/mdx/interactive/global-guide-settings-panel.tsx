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

  return (
    <SettingsSummary
      selections={settings}
      labels={FIELD_LABELS}
      onChangeSettings={() => setShowCustomizer(true)}
    />
  );
}
