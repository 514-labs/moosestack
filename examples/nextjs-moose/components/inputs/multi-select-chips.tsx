"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { FieldOption } from "./types";

export interface MultiSelectChipsProps<TId extends string> {
  /** Available options */
  options: readonly FieldOption<TId>[];
  /** Currently selected values */
  selected: TId[];
  /** Called when selection changes */
  onChange: (selected: TId[]) => void;
  /** Visual variant for chips */
  variant?: "primary" | "secondary";
  /** Disable all chips */
  disabled?: boolean;
  /** Additional CSS classes for container */
  className?: string;
  /** Minimum selections required (default: 0) */
  minSelections?: number;
  /** Maximum selections allowed (default: unlimited) */
  maxSelections?: number;
}

/**
 * Multi-select using toggle chips.
 * Great for selecting dimensions, metrics, or other categorical options.
 */
export function MultiSelectChips<TId extends string>({
  options,
  selected,
  onChange,
  variant = "primary",
  disabled = false,
  className,
  minSelections = 0,
  maxSelections,
}: MultiSelectChipsProps<TId>) {
  const handleValueChange = (value: string[]) => {
    // ToggleGroup returns string[], but we need TId[]
    const newSelected = value as TId[];

    if (maxSelections != null && newSelected.length > maxSelections) {
      return;
    }
    if (newSelected.length < minSelections) {
      return;
    }

    onChange(newSelected);
  };

  return (
    <ToggleGroup
      multiple={true}
      value={selected}
      onValueChange={handleValueChange}
      variant="outline"
      spacing={4}
      className={cn("flex flex-wrap", className)}
    >
      {options.map((option) => {
        const isSelected = selected.includes(option.id);
        const isDisabled =
          disabled ||
          (maxSelections != null &&
            selected.length >= maxSelections &&
            !isSelected);

        return (
          <ToggleGroupItem
            key={option.id}
            value={option.id}
            disabled={isDisabled}
            title={option.description}
            className={cn(
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200",
              variant === "primary" ?
                "data-[state=on]:bg-chart-1 data-[state=on]:border-chart-1 data-[state=on]:text-chart-1-foreground"
              : "data-[state=on]:bg-chart-3 data-[state=on]:border-chart-3 data-[state=on]:text-chart-3-foreground",
            )}
          >
            {option.label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
