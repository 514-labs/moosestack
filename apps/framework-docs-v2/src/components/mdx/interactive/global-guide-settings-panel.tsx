"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconSettings } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useGuideSettings } from "@/contexts/guide-settings-context";
import { GlobalGuideCustomizer } from "./global-guide-customizer";

const FIELD_LABELS: Record<string, string> = {
  language: "Language",
  os: "OS",
  sources: "Sources",
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
  const { settings, isConfigured, showCustomizer, setShowCustomizer } =
    useGuideSettings();

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
    <>
      <div
        className={cn(
          "fixed bottom-6 left-6 z-30 shadow-lg backdrop-blur-md bg-background/95 max-w-sm flex flex-col items-start gap-3 rounded-lg border bg-muted/30 px-4 py-3",
        )}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <IconSettings className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            Your Stack
          </span>
        </div>
        <div className="flex flex-col gap-2 w-full">
          {Object.entries(settings).map(([key, value]) => {
            const displayValue =
              Array.isArray(value) ? value.join(", ") : value;
            return (
              <div
                key={key}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-muted-foreground">
                  {FIELD_LABELS[key] || key}:
                </span>
                <Badge variant="secondary" className="font-normal text-xs">
                  {displayValue}
                </Badge>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2 w-full">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowCustomizer(true)}
            className="flex-1"
          >
            Change
          </Button>
        </div>
      </div>

      {/* Modal for changing settings */}
      <GlobalGuideCustomizer
        open={showCustomizer}
        onClose={() => setShowCustomizer(false)}
      />
    </>
  );
}
