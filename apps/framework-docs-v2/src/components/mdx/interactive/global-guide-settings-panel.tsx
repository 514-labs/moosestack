"use client";

import React, { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useGuideSettings } from "@/contexts/guide-settings-context";
import { GlobalGuideCustomizer } from "./global-guide-customizer";
import { SettingsSummary } from "./settings-summary";
import { Button } from "@/components/ui/button";
import { IconSettings } from "@tabler/icons-react";
import {
  GUIDE_SETTINGS_LABELS,
  GUIDE_SETTINGS_CHIP_LABELS,
} from "@/lib/guide-settings";
import { GUIDE_SETTINGS_CONFIG } from "@/config/guide-settings-config";

/**
 * GlobalGuideSettingsPanel - Persistent settings panel for guide customization
 *
 * Displays current guide settings in a fixed bottom-left panel.
 * Always visible across all guide pages once configured.
 */
export function GlobalGuideSettingsPanel(): React.JSX.Element | null {
  const pathname = usePathname();
  const router = useRouter();
  const { settings, isConfigured, showCustomizer, setShowCustomizer } =
    useGuideSettings();

  // Only show on guide pages (paths starting with /guides/ but not the index)
  const normalizedPath = pathname.replace(/\/$/, ""); // Remove trailing slash
  const isGuidesIndex = normalizedPath === "/guides";
  const isGuidePage = normalizedPath.startsWith("/guides/");

  // Clear URL params when navigating to non-guide pages
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!isGuidePage) {
      const url = new URL(window.location.href);
      const hasParams = url.searchParams.size > 0;

      // Only clear if there are params to avoid unnecessary navigation
      if (hasParams) {
        router.replace(pathname);
      }
    }
  }, [pathname, isGuidePage, router]);

  // Don't show on guides index or non-guide pages
  if (isGuidesIndex || !isGuidePage) {
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
  // Use config's showInSummary flag to determine which settings to show in panel
  const summarySettingIds = new Set<string>(
    GUIDE_SETTINGS_CONFIG.filter(
      (c) => !("showInSummary" in c) || c.showInSummary !== false,
    ).map((c) => c.id),
  );

  const filteredSelections: Record<string, string> = {};
  Object.entries(settings).forEach(([key, value]) => {
    // Skip undefined values or settings not meant for summary panel
    if (!value || !summarySettingIds.has(key)) return;

    // Map value to chip label (uses shorter labels when available)
    const chipLabelMap =
      GUIDE_SETTINGS_CHIP_LABELS[
        key as keyof typeof GUIDE_SETTINGS_CHIP_LABELS
      ];
    const displayValue = chipLabelMap?.[value] || value;
    filteredSelections[key] = displayValue;
  });

  return (
    <>
      {/* Compact button for smaller screens (< lg) */}
      <div className="fixed bottom-6 left-6 z-30 lg:hidden">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCustomizer(true)}
          className="shadow-lg backdrop-blur-md bg-background/95 gap-2"
        >
          <IconSettings className="h-4 w-4" />
          Configure Guide
        </Button>
      </div>

      {/* Full panel for larger screens (lg+) */}
      <SettingsSummary
        selections={filteredSelections}
        labels={GUIDE_SETTINGS_LABELS}
        onChangeSettings={() => setShowCustomizer(true)}
        heading="Your Stack"
        buttonText="Configure"
      />
    </>
  );
}
