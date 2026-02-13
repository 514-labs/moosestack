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
  sourceDatabase: "Sources", // Legacy key for backwards compatibility
  monorepo: "Monorepo",
  existingApp: "Existing app",
};

// Fields to hide from display (still stored in settings)
const HIDDEN_FIELDS = ["monorepo", "existingApp"];

// Value to display label mapping for proper capitalization
const VALUE_LABELS: Record<string, string> = {
  // Languages
  typescript: "TypeScript",
  python: "Python",
  // Operating Systems
  macos: "macOS",
  windows: "Windows",
  // Sources
  postgres: "Postgres",
  sqlserver: "SQL Server",
  mysql: "MySQL",
  api: "REST APIs",
  kafka: "Kafka",
  s3: "S3 / Parquet",
  // Monorepo
  yes: "Yes",
  no: "No",
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
          "fixed bottom-6 left-6 z-30 shadow-lg max-w-sm flex flex-col items-start gap-3 rounded-lg border bg-card px-4 py-3",
        )}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <IconSettings className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">
            Your Stack
          </span>
        </div>
        <div className="flex flex-col gap-2 w-full">
          {Object.entries(settings)
            .filter(([key]) => !HIDDEN_FIELDS.includes(key))
            .map(([key, value]) => {
              // Format display value with proper labels
              const displayValue =
                Array.isArray(value) ?
                  value.map((v) => VALUE_LABELS[v] || v).join(", ")
                : VALUE_LABELS[value as string] || value;

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
