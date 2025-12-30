"use client";

import * as React from "react";
import { Settings } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ChartDisplayOptions, ChartType } from "./chart-types";

// ============================================================================
// Types
// ============================================================================

interface ChartDisplayOptionItem {
  key: string;
  label: string;
  checked: boolean;
}

interface ChartDisplayOptionsProps {
  options: ChartDisplayOptions;
  optionLabels?: Record<string, string>;
  onOptionChange?: (key: string, value: boolean) => void;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  title?: string;
}

interface UseChartDisplayOptionsProps {
  chartType?: ChartType;
  initialOptions?: ChartDisplayOptions;
  optionLabels?: Record<string, string>;
  onOptionsChange?: (options: ChartDisplayOptions) => void;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTION_LABELS: Record<string, string> = {
  showLabels: "Show labels",
  showLegend: "Show legend",
  showGrid: "Show grid",
  showTooltip: "Show tooltip",
} as const;

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for managing chart display options state.
 * Returns the options state, setter function, and component.
 * Supports chart types for type-specific default options.
 */
export function useChartDisplayOptions({
  chartType,
  initialOptions = {},
  optionLabels = DEFAULT_OPTION_LABELS,
  onOptionsChange,
}: UseChartDisplayOptionsProps = {}) {
  // Merge chart type defaults with initial options
  const defaultOptions = React.useMemo(() => {
    if (!chartType) return initialOptions;

    // Import chart configs dynamically to avoid circular dependencies
    // For now, we'll use the initialOptions passed from the widget
    // which already includes chart type defaults
    return initialOptions;
  }, [chartType, initialOptions]);

  const [options, setOptions] =
    React.useState<ChartDisplayOptions>(defaultOptions);

  const handleOptionChange = React.useCallback(
    (key: string, value: boolean) => {
      setOptions((prev) => {
        const next = { ...prev, [key]: value };
        onOptionsChange?.(next);
        return next;
      });
    },
    [onOptionsChange],
  );

  const Component = React.useCallback(
    (props: Omit<ChartDisplayOptionsProps, "options" | "onOptionChange">) => (
      <ChartDisplayOptions
        options={options}
        onOptionChange={handleOptionChange}
        optionLabels={optionLabels}
        {...props}
      />
    ),
    [options, handleOptionChange, optionLabels],
  );

  return {
    options,
    setOptions,
    ChartDisplayOptions: Component,
  };
}

// ============================================================================
// Component
// ============================================================================

/**
 * Chart display options component.
 * Provides a popover interface for toggling chart display settings.
 */
export function ChartDisplayOptions({
  options,
  optionLabels = DEFAULT_OPTION_LABELS,
  onOptionChange,
  className,
  triggerClassName,
  contentClassName,
  title = "Display Options",
}: ChartDisplayOptionsProps) {
  const optionKeys = Object.keys(options);

  // Transform options into option items with labels
  const optionItems: ChartDisplayOptionItem[] = React.useMemo(
    () =>
      optionKeys.map((key) => ({
        key,
        label: optionLabels[key] || key,
        checked: options[key] ?? true,
      })),
    [optionKeys, optionLabels, options],
  );

  // Handle option change with explicit typing
  const handleOptionChange = React.useCallback(
    (key: string, checked: boolean) => {
      onOptionChange?.(key, checked);
    },
    [onOptionChange],
  );

  // Early return if no options provided
  if (optionKeys.length === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: "outline", size: "icon" }),
          "data-slot",
          triggerClassName,
          className,
        )}
        data-slot="chart-display-options-trigger"
      >
        <Settings className="size-4" />
        <span className="sr-only">Display options</span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={cn("w-[200px]", contentClassName)}
        data-slot="chart-display-options-content"
      >
        <div className="space-y-3">
          <h4 className="font-medium text-sm">{title}</h4>
          <div className="space-y-2">
            {optionItems.map((option) => (
              <ChartDisplayOptionItem
                key={option.key}
                option={option}
                onCheckedChange={(checked) =>
                  handleOptionChange(option.key, checked)
                }
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

interface ChartDisplayOptionItemProps {
  option: ChartDisplayOptionItem;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * Individual display option item with checkbox and label.
 */
function ChartDisplayOptionItem({
  option,
  onCheckedChange,
}: ChartDisplayOptionItemProps) {
  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onCheckedChange(event.target.checked);
    },
    [onCheckedChange],
  );

  return (
    <div
      className="flex items-center space-x-2"
      data-slot="chart-display-options-item"
    >
      <input
        type="checkbox"
        id={option.key}
        checked={option.checked}
        onChange={handleChange}
        className={cn(
          "h-4 w-4 rounded border-input",
          "text-primary focus:ring-primary focus:ring-2",
          "cursor-pointer",
          "data-slot",
        )}
        data-slot="chart-display-options-checkbox"
      />
      <Label
        htmlFor={option.key}
        className="text-sm font-normal cursor-pointer"
        data-slot="chart-display-options-label"
      >
        {option.label}
      </Label>
    </div>
  );
}

// ============================================================================
// Exports
// ============================================================================

export { DEFAULT_OPTION_LABELS };

export type {
  ChartDisplayOptionsProps,
  ChartDisplayOptionItem,
  UseChartDisplayOptionsProps,
};
