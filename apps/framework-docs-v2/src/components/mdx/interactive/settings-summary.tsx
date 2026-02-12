"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconSettings } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface SettingsSummaryProps {
  selections: Record<string, string>;
  labels?: Record<string, string>;
  onChangeSettings: () => void;
  className?: string;
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
}: SettingsSummaryProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-4 py-3 mb-6",
        className,
      )}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <IconSettings className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">
          Tutorial customized for:
        </span>
        {Object.entries(selections).map(([key, value]) => (
          <Badge key={key} variant="secondary" className="font-normal">
            {labels[key] ? `${labels[key]}: ${value}` : value}
          </Badge>
        ))}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onChangeSettings}
        className="shrink-0"
      >
        Change
      </Button>
    </div>
  );
}
