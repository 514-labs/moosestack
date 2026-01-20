"use client";

/**
 * Simple, headless-ish UI components for the Report Builder.
 *
 * These components accept props directly (no context dependency),
 * making them easy to understand and customize.
 */

import * as React from "react";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  SelectDropdown,
  DatePicker,
  MultiSelectChips as BaseMultiSelectChips,
} from "@/components/inputs";
import { LayoutGrid, BarChart3, X, Loader2 } from "lucide-react";
import type { FieldOption, FilterMeta, FilterValue } from "./types";

// =============================================================================
// Dimension Chips
// =============================================================================

export interface DimensionChipsProps {
  /** Available dimension options */
  options: FieldOption[];
  /** Currently selected dimension IDs */
  selected: string[];
  /** Called when a dimension is toggled */
  onToggle: (id: string) => void;
  /** Additional CSS classes */
  className?: string;
  /** Show icon */
  showIcon?: boolean;
  /** Label text */
  label?: string;
}

/**
 * Chip-based dimension selector.
 * Click chips to toggle dimensions on/off.
 */
export function DimensionChips({
  options,
  selected,
  onToggle,
  className,
  showIcon = true,
  label = "Breakdown",
}: DimensionChipsProps) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-2">
        {showIcon && (
          <div className="p-1 rounded bg-chart-3/10">
            <LayoutGrid className="size-3.5 text-chart-3" />
          </div>
        )}
        <Label className="text-sm font-medium">{label}</Label>
      </div>
      <ToggleGroup
        multiple={true}
        value={selected}
        onValueChange={(values) => {
          // Find which one changed and toggle it
          const added = values.find((v) => !selected.includes(v));
          const removed = selected.find((s) => !values.includes(s));
          if (added) onToggle(added);
          else if (removed) onToggle(removed);
        }}
        className="flex flex-wrap gap-1"
      >
        {options.map((option) => (
          <ToggleGroupItem
            key={option.id}
            value={option.id}
            title={option.description}
            className="px-2 py-1 text-sm font-medium rounded-md border hover:bg-muted"
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

// =============================================================================
// Metric Chips
// =============================================================================

export interface MetricChipsProps {
  /** Available metric options */
  options: FieldOption[];
  /** Currently selected metric IDs */
  selected: string[];
  /** Called when a metric is toggled */
  onToggle: (id: string) => void;
  /** Additional CSS classes */
  className?: string;
  /** Show icon */
  showIcon?: boolean;
  /** Label text */
  label?: string;
}

/**
 * Chip-based metric selector.
 * Click chips to toggle metrics on/off.
 */
export function MetricChips({
  options,
  selected,
  onToggle,
  className,
  showIcon = true,
  label = "Metrics",
}: MetricChipsProps) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-2">
        {showIcon && (
          <div className="p-1 rounded bg-chart-1/10">
            <BarChart3 className="size-3.5 text-chart-1" />
          </div>
        )}
        <Label className="text-sm font-medium">{label}</Label>
      </div>
      <ToggleGroup
        multiple={true}
        value={selected}
        onValueChange={(values) => {
          const added = values.find((v) => !selected.includes(v));
          const removed = selected.find((s) => !values.includes(s));
          if (added) onToggle(added);
          else if (removed) onToggle(removed);
        }}
        className="flex flex-wrap gap-1"
      >
        {options.map((option) => (
          <ToggleGroupItem
            key={option.id}
            value={option.id}
            title={option.description}
            className="px-2 py-1 text-sm font-medium rounded-md border hover:bg-muted"
          >
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

// =============================================================================
// Filter Row
// =============================================================================

/**
 * Operator display labels.
 */
const OPERATOR_LABELS: Record<string, string> = {
  eq: "equals",
  ne: "is not",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "contains",
  ilike: "contains",
  in: "is one of",
  notIn: "is not one of",
  isNull: "is empty",
  isNotNull: "is not empty",
};

export interface FilterRowProps {
  /** Filter metadata */
  filter: FilterMeta;
  /** Current filter value: { operator: value } */
  value?: FilterValue;
  /** Called when filter changes */
  onChange: (operator: string, value: unknown) => void;
  /** Called when filter is cleared */
  onClear?: () => void;
  /** Additional CSS classes */
  className?: string;
  /** Show clear button */
  showClear?: boolean;
}

/**
 * Single filter row with operator and value inputs.
 * Automatically renders the appropriate input based on filter.inputType.
 */
export function FilterRow({
  filter,
  value,
  onChange,
  onClear,
  className,
  showClear = true,
}: FilterRowProps) {
  // Get current operator and value
  const currentOperator = value ? Object.keys(value)[0] : filter.operators[0];
  const currentValue = value?.[currentOperator];

  const handleOperatorChange = (newOp: string) => {
    // Convert value if needed (e.g., single → array for 'in')
    const isArrayOp = newOp === "in" || newOp === "notIn";
    const wasArrayOp = currentOperator === "in" || currentOperator === "notIn";

    let newValue = currentValue;
    if (isArrayOp && !wasArrayOp && currentValue) {
      newValue = [String(currentValue)];
    } else if (!isArrayOp && wasArrayOp && Array.isArray(currentValue)) {
      newValue = currentValue[0] ?? "";
    }

    onChange(newOp, newValue);
  };

  const handleValueChange = (newValue: unknown) => {
    onChange(currentOperator, newValue);
  };

  // Render value input based on type and operator
  const renderValueInput = () => {
    // Null check operators don't need value
    if (currentOperator === "isNull" || currentOperator === "isNotNull") {
      return (
        <span className="text-sm text-muted-foreground italic px-2">
          (no value needed)
        </span>
      );
    }

    // Array operators use multi-select
    if (currentOperator === "in" || currentOperator === "notIn") {
      const options = filter.options ?? [];
      return (
        <ToggleGroup
          multiple={true}
          value={(currentValue as string[]) ?? []}
          onValueChange={handleValueChange}
          className="flex flex-wrap gap-1"
        >
          {options.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className="px-2 py-1 text-sm font-medium rounded-md border hover:bg-muted"
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      );
    }

    // Based on inputType
    switch (filter.inputType) {
      case "date":
        return (
          <DatePicker
            value={(currentValue as string) ?? ""}
            onChange={handleValueChange}
            placeholder="Select date"
          />
        );

      case "number":
        return (
          <Input
            type="number"
            value={(currentValue as number) ?? ""}
            onChange={(e) =>
              handleValueChange(
                e.target.value === "" ? undefined : Number(e.target.value),
              )
            }
            placeholder="Enter number"
            className="bg-background w-[120px]"
          />
        );

      case "select":
        const selectOptions = filter.options ?? [];
        return (
          <SelectDropdown
            value={(currentValue as string) ?? ""}
            options={selectOptions.map((o) => ({
              id: o.value,
              label: o.label,
            }))}
            onChange={handleValueChange}
            placeholder="Select..."
          />
        );

      case "text":
      default:
        return (
          <Input
            type="text"
            value={(currentValue as string) ?? ""}
            onChange={(e) => handleValueChange(e.target.value || undefined)}
            placeholder="Enter value"
            className="bg-background w-[150px]"
          />
        );
    }
  };

  // Check if there's an actual non-empty value (not just an operator with undefined/empty value)
  const hasValue =
    value &&
    Object.values(value).some(
      (v) =>
        v !== undefined &&
        v !== null &&
        v !== "" &&
        !(Array.isArray(v) && v.length === 0),
    );

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Label className="text-sm text-muted-foreground min-w-[80px]">
        {filter.label}
      </Label>

      {/* Operator selector (only if multiple operators) */}
      {filter.operators.length > 1 && (
        <SelectDropdown
          value={currentOperator}
          options={filter.operators.map((op) => ({
            id: op,
            label: OPERATOR_LABELS[op] ?? op,
          }))}
          onChange={handleOperatorChange}
          width="w-[120px]"
        />
      )}

      {/* Value input */}
      {renderValueInput()}

      {/* Clear button */}
      {showClear && hasValue && onClear && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}

// =============================================================================
// Execute Button
// =============================================================================

export interface ExecuteButtonProps {
  /** Called when button is clicked */
  onClick: () => void;
  /** Whether query is loading */
  isLoading?: boolean;
  /** Button label */
  label?: string;
  /** Loading label */
  loadingLabel?: string;
  /** Additional CSS classes */
  className?: string;
  /** Disabled state */
  disabled?: boolean;
}

/**
 * Simple execute/refresh button.
 */
export function ExecuteButton({
  onClick,
  isLoading = false,
  label = "Run Query",
  loadingLabel = "Running...",
  className,
  disabled = false,
}: ExecuteButtonProps) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled || isLoading}
      className={className}
    >
      {isLoading ?
        <>
          <Loader2 className="size-4 animate-spin mr-2" />
          {loadingLabel}
        </>
      : label}
    </Button>
  );
}

// =============================================================================
// Simple Results Table
// =============================================================================

export interface SimpleResultsTableProps {
  /** Query results */
  data: unknown[];
  /** Selected dimension IDs */
  dimensions: string[];
  /** Selected metric IDs */
  metrics: string[];
  /** Model with field metadata (for labels and dataKeys) */
  model: {
    dimensions: FieldOption[];
    metrics: FieldOption[];
  };
  /** Additional CSS classes */
  className?: string;
}

/**
 * Simple results table that uses model metadata for labels and dataKeys.
 */
export function SimpleResultsTable({
  data,
  dimensions,
  metrics,
  model,
  className,
}: SimpleResultsTableProps) {
  if (data.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No results found
      </div>
    );
  }

  // Build column info
  const columns = [...dimensions, ...metrics];
  const getLabel = (id: string) => {
    const dim = model.dimensions.find((d) => d.id === id);
    if (dim) return dim.label;
    const metric = model.metrics.find((m) => m.id === id);
    if (metric) return metric.label;
    return id;
  };
  const getDataKey = (id: string) => {
    const dim = model.dimensions.find((d) => d.id === id);
    if (dim?.dataKey) return dim.dataKey;
    const metric = model.metrics.find((m) => m.id === id);
    if (metric?.dataKey) return metric.dataKey;
    return id;
  };

  const formatValue = (key: string, value: unknown): string => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "number") {
      if (key.toLowerCase().includes("ratio")) {
        return `${(value * 100).toFixed(1)}%`;
      }
      if (key.toLowerCase().includes("amount")) {
        return `$${value.toLocaleString()}`;
      }
      return value.toLocaleString();
    }
    return String(value);
  };

  return (
    <div className={cn("rounded-lg border overflow-hidden", className)}>
      <table className="w-full">
        <thead>
          <tr className="bg-muted/50">
            {columns.map((col) => (
              <th
                key={col}
                className={cn(
                  "px-4 py-3 text-left text-sm font-semibold",
                  dimensions.includes(col) ? "text-chart-3" : "text-chart-1",
                  metrics.includes(col) && "text-right",
                )}
              >
                {getLabel(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(data as Record<string, unknown>[]).map((row, i) => (
            <tr key={i} className="border-t hover:bg-muted/30">
              {columns.map((col) => (
                <td
                  key={col}
                  className={cn(
                    "px-4 py-3 text-sm",
                    metrics.includes(col) ?
                      "text-right font-mono tabular-nums"
                    : "font-medium",
                  )}
                >
                  {formatValue(col, row[getDataKey(col)])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
