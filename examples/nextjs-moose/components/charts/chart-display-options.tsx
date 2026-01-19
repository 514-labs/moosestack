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
import { type ChartDisplayOptions, DEFAULT_OPTION_LABELS } from "./types";

interface ChartDisplayOptionItem {
  key: string;
  label: string;
  checked: boolean;
}

export interface ChartDisplayOptionsProps {
  options: ChartDisplayOptions;
  optionLabels?: Record<string, string>;
  onOptionChange?: (key: string, value: boolean) => void;
  className?: string;
  triggerClassName?: string;
  contentClassName?: string;
  title?: string;
}

export interface UseChartDisplayOptionsProps {
  initialOptions?: ChartDisplayOptions;
  optionLabels?: Record<string, string>;
  onOptionsChange?: (options: ChartDisplayOptions) => void;
}

/**
 * Hook for managing chart display options state.
 */
export function useChartDisplayOptions({
  initialOptions = {},
  optionLabels = DEFAULT_OPTION_LABELS,
  onOptionsChange,
}: UseChartDisplayOptionsProps = {}) {
  const defaultOptions = React.useMemo(() => initialOptions, [initialOptions]);

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
      <ChartDisplayOptionsPopover
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

/**
 * Chart display options popover component.
 */
export function ChartDisplayOptionsPopover({
  options,
  optionLabels = DEFAULT_OPTION_LABELS,
  onOptionChange,
  className,
  triggerClassName,
  contentClassName,
  title = "Display Options",
}: ChartDisplayOptionsProps) {
  const optionKeys = Object.keys(options);

  const optionItems: ChartDisplayOptionItem[] = React.useMemo(
    () =>
      optionKeys.map((key) => ({
        key,
        label: optionLabels[key] || key,
        checked: options[key] ?? true,
      })),
    [optionKeys, optionLabels, options],
  );

  const handleOptionChange = React.useCallback(
    (key: string, checked: boolean) => {
      onOptionChange?.(key, checked);
    },
    [onOptionChange],
  );

  if (optionKeys.length === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          buttonVariants({ variant: "outline", size: "icon" }),
          triggerClassName,
          className,
        )}
      >
        <Settings className="size-4" />
        <span className="sr-only">Display options</span>
      </PopoverTrigger>
      <PopoverContent align="end" className={cn("w-[200px]", contentClassName)}>
        <div className="space-y-3">
          <h4 className="font-medium text-sm">{title}</h4>
          <div className="space-y-2">
            {optionItems.map((option) => (
              <OptionItem
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

interface OptionItemProps {
  option: ChartDisplayOptionItem;
  onCheckedChange: (checked: boolean) => void;
}

function OptionItem({ option, onCheckedChange }: OptionItemProps) {
  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onCheckedChange(event.target.checked);
    },
    [onCheckedChange],
  );

  return (
    <div className="flex items-center space-x-2">
      <input
        type="checkbox"
        id={option.key}
        checked={option.checked}
        onChange={handleChange}
        className={cn(
          "h-4 w-4 rounded border-input",
          "text-primary focus:ring-primary focus:ring-2",
          "cursor-pointer",
        )}
      />
      <Label
        htmlFor={option.key}
        className="text-sm font-normal cursor-pointer"
      >
        {option.label}
      </Label>
    </div>
  );
}
