"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { LayoutGrid, BarChart3, Filter, Loader2, X } from "lucide-react";
import type {
  FieldOption,
  FilterOption,
  FilterValue,
  ReportModel,
} from "./types";

// =============================================================================
// Chip Selector (shared)
// =============================================================================

function ChipSelector({
  options,
  selected,
  onToggle,
  className,
  label,
  sublabel,
  icon,
  iconBgClass,
}: {
  options: FieldOption[];
  selected: string[];
  onToggle: (id: string) => void;
  className?: string;
  label: string;
  sublabel?: string;
  icon: React.ReactNode;
  iconBgClass: string;
}) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-2">
        <div className={cn("p-1 rounded", iconBgClass)}>{icon}</div>
        <div>
          <Label className="text-sm font-medium">{label}</Label>
          {sublabel && (
            <p className="text-xs text-muted-foreground">{sublabel}</p>
          )}
        </div>
      </div>
      <ToggleGroup
        type="multiple"
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
// Shared formatting
// =============================================================================

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "\u2014";
  if (typeof value === "number") {
    if (
      key.toLowerCase().includes("amount") ||
      key.toLowerCase().includes("revenue")
    ) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(value);
    }
    return value.toLocaleString();
  }
  if (value === "") return "(empty)";
  return String(value);
}

// =============================================================================
// Metric Chips
// =============================================================================

export function MetricChips({
  options,
  selected,
  onToggle,
  className,
}: {
  options: FieldOption[];
  selected: string[];
  onToggle: (id: string) => void;
  className?: string;
}) {
  return (
    <ChipSelector
      options={options}
      selected={selected}
      onToggle={onToggle}
      className={className}
      label="Metrics"
      sublabel="What to measure"
      icon={<BarChart3 className="size-3.5 text-chart-1" />}
      iconBgClass="bg-chart-1/10"
    />
  );
}

// =============================================================================
// Dimension Chips
// =============================================================================

export function DimensionChips({
  options,
  selected,
  onToggle,
  className,
}: {
  options: FieldOption[];
  selected: string[];
  onToggle: (id: string) => void;
  className?: string;
}) {
  return (
    <ChipSelector
      options={options}
      selected={selected}
      onToggle={onToggle}
      className={className}
      label="Dimensions"
      sublabel="How to group results"
      icon={<LayoutGrid className="size-3.5 text-chart-3" />}
      iconBgClass="bg-chart-3/10"
    />
  );
}

// =============================================================================
// Filter Controls
// =============================================================================

function FilterControl({
  filter,
  value,
  onSet,
  onClear,
}: {
  filter: FilterOption;
  value: FilterValue | undefined;
  onSet: (operator: string, value: unknown) => void;
  onClear: () => void;
}) {
  // For filters with known values, show toggle chips
  if (filter.values && filter.values.length > 0) {
    const currentIn = (value?.in as string[] | undefined) ?? [];
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs font-medium text-muted-foreground">
            {filter.label}
          </Label>
          {currentIn.length > 0 && (
            <button
              onClick={onClear}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
            >
              <X className="size-3" /> Clear
            </button>
          )}
        </div>
        <ToggleGroup
          type="multiple"
          value={currentIn}
          onValueChange={(values) => {
            if (values.length === 0) {
              onClear();
            } else {
              onSet("in", values);
            }
          }}
          className="flex flex-wrap gap-1"
        >
          {filter.values.map((v) => (
            <ToggleGroupItem
              key={v.value}
              value={v.value}
              className="px-2 py-0.5 text-xs font-medium rounded-md border hover:bg-muted"
            >
              {v.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    );
  }

  // For free-text filters, show an input
  const currentValue = (value?.eq as string | undefined) ?? "";
  return (
    <div>
      <Label className="text-xs font-medium text-muted-foreground">
        {filter.label}
      </Label>
      <div className="flex items-center gap-1 mt-1">
        <Input
          placeholder={filter.description ?? `Filter by ${filter.label}...`}
          value={currentValue}
          onChange={(e) => {
            if (e.target.value === "") {
              onClear();
            } else {
              onSet("eq", e.target.value);
            }
          }}
          className="h-7 text-xs"
        />
        {currentValue && (
          <button
            onClick={onClear}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function FilterControls({
  filters,
  values,
  onSet,
  onClear,
  onClearAll,
  className,
}: {
  filters: FilterOption[];
  values: Record<string, FilterValue>;
  onSet: (id: string, operator: string, value: unknown) => void;
  onClear: (id: string) => void;
  onClearAll: () => void;
  className?: string;
}) {
  const hasAnyFilter = Object.keys(values).length > 0;

  return (
    <div className={className}>
      <div className="flex items-center gap-2 mb-2">
        <div className="p-1 rounded bg-chart-2/10">
          <Filter className="size-3.5 text-chart-2" />
        </div>
        <div className="flex-1">
          <Label className="text-sm font-medium">Filters</Label>
          <p className="text-xs text-muted-foreground">Which rows to include</p>
        </div>
        {hasAnyFilter && (
          <button
            onClick={onClearAll}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear all
          </button>
        )}
      </div>
      <div className="space-y-3">
        {filters.map((f) => (
          <FilterControl
            key={f.id}
            filter={f}
            value={values[f.id]}
            onSet={(op, val) => onSet(f.id, op, val)}
            onClear={() => onClear(f.id)}
          />
        ))}
      </div>
    </div>
  );
}

// =============================================================================
// Results Table
// =============================================================================

export function SimpleResultsTable({
  data,
  dimensions,
  metrics,
  model,
  className,
}: {
  data: unknown[];
  dimensions: string[];
  metrics: string[];
  model: ReportModel;
  className?: string;
}) {
  if (data.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        No results found
      </div>
    );
  }

  const columns = [...dimensions, ...metrics];
  const getFieldOption = (id: string): FieldOption | undefined =>
    model.dimensions.find((d) => d.id === id) ??
    model.metrics.find((m) => m.id === id);

  const getLabel = (id: string) => getFieldOption(id)?.label ?? id;
  const getDataKey = (id: string) => getFieldOption(id)?.dataKey ?? id;

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
          {(data as Record<string, unknown>[]).map((row, i) => {
            const rowKey =
              dimensions.length > 0 ?
                dimensions
                  .map((d) => String(row[getDataKey(d)] ?? ""))
                  .join("-") || `row-${i}`
              : `row-${i}`;

            return (
              <tr key={rowKey} className="border-t hover:bg-muted/30">
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// Results Chart
// =============================================================================

export function ResultsChart({
  data,
  dimensions,
  metrics,
  model,
  className,
}: {
  data: unknown[];
  dimensions: string[];
  metrics: string[];
  model: ReportModel;
  className?: string;
}) {
  if (data.length === 0 || dimensions.length === 0 || metrics.length === 0) {
    return null;
  }

  const getFieldOption = (id: string): FieldOption | undefined =>
    model.dimensions.find((d) => d.id === id) ??
    model.metrics.find((m) => m.id === id);
  const getDataKey = (id: string) => getFieldOption(id)?.dataKey ?? id;
  const getLabel = (id: string) => getFieldOption(id)?.label ?? id;

  const dimKey = getDataKey(dimensions[0]);
  const maxValues: Record<string, number> = {};
  for (const m of metrics) {
    const dk = getDataKey(m);
    let max = 0;
    for (const row of data as Record<string, unknown>[]) {
      const v = Number(row[dk]) || 0;
      if (v > max) max = v;
    }
    maxValues[dk] = max;
  }

  const COLORS = [
    "bg-chart-1",
    "bg-chart-2",
    "bg-chart-3",
    "bg-chart-4",
    "bg-chart-5",
  ];

  return (
    <div className={cn("rounded-lg border p-4 space-y-4", className)}>
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {metrics.map((m, i) => (
          <div key={m} className="flex items-center gap-1.5">
            <div
              className={cn("w-3 h-3 rounded-sm", COLORS[i % COLORS.length])}
            />
            {getLabel(m)}
          </div>
        ))}
      </div>
      <div className="space-y-2">
        {(data as Record<string, unknown>[]).map((row, i) => {
          const label = String(row[dimKey] ?? `Row ${i}`);
          return (
            <div key={label} className="space-y-1">
              <div className="text-xs font-medium truncate">{label}</div>
              {metrics.map((m, mi) => {
                const dk = getDataKey(m);
                const val = Number(row[dk]) || 0;
                const max = maxValues[dk] || 1;
                const pct = (val / max) * 100;
                return (
                  <div key={m} className="flex items-center gap-2">
                    <div className="w-full h-4 rounded bg-muted overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded transition-all",
                          COLORS[mi % COLORS.length],
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-xs font-mono tabular-nums text-muted-foreground w-28 text-right shrink-0">
                      {formatValue(m, val)}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// Loading State
// =============================================================================

export function QueryStatus({ isFetching }: { isFetching: boolean }) {
  if (!isFetching) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Querying...
    </div>
  );
}
