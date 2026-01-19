"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { X, Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChartTypeConfig, GridSpan, ChartDisplayOptions } from "./types";
import { useChartDisplayOptions } from "./chart-display-options";

export interface ChartWidgetProps {
  /** Chart identity */
  chartId: string;
  chartType: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;

  /** Layout */
  gridSpan?: GridSpan;

  /** Chart content - receives options and expanded state */
  children:
    | React.ReactNode
    | ((props: {
        isExpanded: boolean;
        options: ChartDisplayOptions;
      }) => React.ReactNode);

  /** Chart-specific config */
  chartConfig: ChartTypeConfig;

  /** Styling */
  className?: string;
  triggerSize?: "sm" | "md" | "lg";
}

/**
 * Generic chart widget wrapper with fullscreen support and display options.
 */
export function ChartWidget({
  chartId: _chartId,
  chartType: _chartType,
  title,
  description,
  icon,
  gridSpan,
  children,
  chartConfig,
  className,
  triggerSize = "md",
}: ChartWidgetProps): React.JSX.Element {
  void _chartId;
  void _chartType;

  const [isExpanded, setIsExpanded] = React.useState(false);

  const { options, ChartDisplayOptions } = useChartDisplayOptions({
    initialOptions: chartConfig.displayOptions,
  });

  const openFullscreen = React.useCallback(() => {
    setIsExpanded(true);
  }, []);

  const closeFullscreen = React.useCallback(() => {
    setIsExpanded(false);
  }, []);

  // Handle ESC key to close fullscreen
  React.useEffect(() => {
    if (!isExpanded) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeFullscreen();
      }
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [isExpanded, closeFullscreen]);

  const triggerSizeClass = {
    sm: "size-7 sm:size-8",
    md: "size-8",
    lg: "size-9",
  }[triggerSize];

  const gridSpanClasses = React.useMemo(() => {
    if (!gridSpan) return "";
    const classes: string[] = [];

    const spanMap: Record<number, string> = {
      1: "col-span-1",
      2: "col-span-2",
      3: "col-span-3",
      4: "col-span-4",
      5: "col-span-5",
      6: "col-span-6",
      7: "col-span-7",
      8: "col-span-8",
      9: "col-span-9",
      10: "col-span-10",
      11: "col-span-11",
      12: "col-span-12",
    };

    if (gridSpan.sm && spanMap[gridSpan.sm]) {
      classes.push(spanMap[gridSpan.sm]);
    }
    if (gridSpan.md && spanMap[gridSpan.md]) {
      classes.push(`md:${spanMap[gridSpan.md]}`);
    }
    if (gridSpan.lg && spanMap[gridSpan.lg]) {
      classes.push(`lg:${spanMap[gridSpan.lg]}`);
    }
    if (gridSpan.xl && spanMap[gridSpan.xl]) {
      classes.push(`xl:${spanMap[gridSpan.xl]}`);
    }

    return classes.join(" ");
  }, [gridSpan]);

  const renderContent = (expanded: boolean): React.ReactNode => {
    return typeof children === "function" ?
        children({ isExpanded: expanded, options })
      : children;
  };

  return (
    <>
      <div
        className={cn(
          "flex flex-col gap-4 p-4 sm:p-6 rounded-xl border bg-card",
          gridSpanClasses,
          className,
        )}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 sm:gap-2.5">
            {icon && (
              <Button
                variant="outline"
                size="icon"
                className="size-7 sm:size-8"
              >
                {icon}
              </Button>
            )}
            <div>
              <h3 className="text-sm sm:text-base font-semibold">{title}</h3>
              {description && (
                <p className="text-xs sm:text-sm text-muted-foreground">
                  {description}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ChartDisplayOptions triggerClassName={triggerSizeClass} />
            <Button
              variant="ghost"
              size="icon"
              onClick={openFullscreen}
              className={triggerSizeClass}
            >
              <Maximize2 className="size-4 text-muted-foreground" />
              <span className="sr-only">Full screen</span>
            </Button>
          </div>
        </div>
        {renderContent(false)}
      </div>

      {isExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm p-6"
          onClick={closeFullscreen}
        >
          <div
            className="relative w-full max-w-6xl rounded-xl border bg-card p-8 shadow-lg max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                {icon && <div className="text-muted-foreground">{icon}</div>}
                <div>
                  <h2 className="text-xl font-semibold">{title}</h2>
                  {description && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {description}
                    </p>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={closeFullscreen}
                className="size-8"
              >
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </Button>
            </div>

            <div className="w-full">{renderContent(true)}</div>
          </div>
        </div>
      )}
    </>
  );
}
