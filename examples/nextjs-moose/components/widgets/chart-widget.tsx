"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface ChartWidgetProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  headerRight?: React.ReactNode;
  className?: string;
}

/**
 * Simple chart wrapper with header and optional controls.
 */
export function ChartWidget({
  title,
  description,
  children,
  headerRight,
  className,
}: ChartWidgetProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 p-4 sm:p-6 rounded-xl border bg-card",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 sm:gap-2.5">
          <div>
            <h3 className="text-sm sm:text-base font-semibold">{title}</h3>
            {description && (
              <p className="text-xs sm:text-sm text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>
        {headerRight && (
          <div className="flex items-center gap-2">{headerRight}</div>
        )}
      </div>
      {children}
    </div>
  );
}
