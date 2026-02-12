"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconSettings } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface SettingsSummaryProps {
  selections: Record<string, string>;
  labels?: Record<string, string>;
  onChangeSettings: () => void;
  className?: string;
  /** Where to render the summary: inline (default), sticky-top, or sidebar */
  placement?: "inline" | "sticky-top" | "sidebar";
}

/**
 * SettingsSummary - Compact display of current tutorial customization selections
 *
 * Shows selected options as badges with a "Change settings" button.
 * Appears at the top of tutorial content after customization is complete.
 *
 * @example
 * ```tsx
 * <SettingsSummary
 *   selections={{ "source-database": "postgres", "os": "macos" }}
 *   labels={{ "source-database": "Database", "os": "OS" }}
 *   onChangeSettings={() => setShowCustomizer(true)}
 * />
 * ```
 */
export function SettingsSummary({
  selections,
  labels = {},
  onChangeSettings,
  className,
  placement = "inline",
}: SettingsSummaryProps): React.JSX.Element {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  // Find portal target for sidebar placement
  useEffect(() => {
    if (placement === "sidebar") {
      const target = document.getElementById("settings-summary-sidebar");
      setPortalTarget(target);
    }
  }, [placement]);

  const baseClasses =
    "flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-3";

  const placementClasses = {
    inline: "mb-6",
    "sticky-top":
      "sticky top-[var(--header-height)] z-20 backdrop-blur-sm bg-background/95 border-b shadow-sm mb-6 -mx-4 rounded-none border-x-0",
    sidebar: "mb-6 flex-col items-start gap-3",
  };

  const content = (
    <div className={cn(baseClasses, placementClasses[placement], className)}>
      <div className="flex items-center gap-2 flex-wrap">
        <IconSettings className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          Tutorial settings
        </span>
      </div>
      <div className="flex flex-col gap-2 w-full">
        {Object.entries(selections).map(([key, value]) => (
          <div key={key} className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{labels[key] || key}:</span>
            <Badge variant="secondary" className="font-normal text-xs">
              {value}
            </Badge>
          </div>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onChangeSettings}
        className="w-full"
      >
        Change
      </Button>
    </div>
  );

  // Use portal for sidebar placement
  if (placement === "sidebar" && portalTarget) {
    return createPortal(content, portalTarget);
  }

  return content;
}
