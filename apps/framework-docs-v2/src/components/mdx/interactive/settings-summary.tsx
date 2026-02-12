"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IconSettings, IconRefresh } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

interface SettingsSummaryProps {
  selections: Record<string, string>;
  labels?: Record<string, string>;
  onChangeSettings: () => void;
  className?: string;
  showBorealSync?: boolean;
}

/**
 * SettingsSummary - Compact display of current tutorial customization selections
 *
 * Shows selected options in a fixed bottom-left panel with a "Change" button.
 * Appears after the wizard customization is complete.
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
  showBorealSync = false,
}: SettingsSummaryProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "fixed bottom-6 left-6 z-30 shadow-lg backdrop-blur-md bg-background/95 max-w-sm flex flex-col items-start gap-3 rounded-lg border bg-muted/30 px-4 py-3",
        className,
      )}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <IconSettings className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">
          Guide config
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
      <div className="flex gap-2 w-full">
        {showBorealSync && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              // TODO: Implement Boreal sync
              console.log("Boreal sync");
            }}
            className="flex-1"
          >
            <IconRefresh className="mr-1 h-3 w-3" />
            Boreal sync
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={onChangeSettings}
          className="flex-1"
        >
          Change
        </Button>
      </div>
    </div>
  );
}
