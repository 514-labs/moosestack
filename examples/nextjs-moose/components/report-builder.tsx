"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DatePickerInput } from "@/components/date-picker-input";
import { getReport } from "@/app/actions/report";
import {
  DIMENSIONS,
  METRICS,
  type ReportParams,
  type ReportResult,
  type DimensionId,
  type MetricId,
} from "@/lib/report-config";
import {
  LayoutGrid,
  BarChart3,
  Play,
  Loader2,
  TableIcon,
  TrendingUp,
  Calendar,
} from "lucide-react";

// =============================================================================
// Toggle Chip Component
// =============================================================================

interface ToggleChipProps {
  label: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
  variant?: "dimension" | "metric";
}

function ToggleChip({
  label,
  description,
  selected,
  onClick,
  variant = "dimension",
}: ToggleChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={description}
      className={cn(
        "px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200",
        "border focus:outline-none focus:ring-2 focus:ring-offset-1",
        selected ?
          variant === "dimension" ?
            "bg-chart-3 text-white border-chart-3 shadow-md shadow-chart-3/25"
          : "bg-chart-1 text-white border-chart-1 shadow-md shadow-chart-1/25"
        : "bg-card border-border text-muted-foreground hover:bg-muted hover:text-foreground hover:border-muted-foreground/30",
      )}
    >
      {label}
    </button>
  );
}

// =============================================================================
// Results Table Component
// =============================================================================

interface ResultsTableProps {
  data: ReportResult[];
  dimensions: DimensionId[];
  metrics: MetricId[];
}

function ResultsTable({ data, dimensions, metrics }: ResultsTableProps) {
  const dimensionLabels = DIMENSIONS.reduce(
    (acc, d) => ({ ...acc, [d.id]: d.label }),
    {} as Record<string, string>,
  );
  const metricLabels = METRICS.reduce(
    (acc, m) => ({ ...acc, [m.id]: m.label }),
    {} as Record<string, string>,
  );

  const formatValue = (key: string, value: unknown): string => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "number") {
      if (key === "highValueRatio") return `${(value * 100).toFixed(1)}%`;
      if (key.includes("Amount")) return `$${value.toLocaleString()}`;
      return value.toLocaleString();
    }
    return String(value);
  };

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <TableIcon className="size-12 mb-4 opacity-40" />
        <p className="text-lg font-medium">No results</p>
        <p className="text-sm">Try adjusting your filters or selections</p>
      </div>
    );
  }

  const columns = [...dimensions, ...metrics];

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 border-b border-border">
            {columns.map((col) => (
              <th
                key={col}
                className={cn(
                  "px-4 py-3 text-left font-semibold",
                  dimensions.includes(col as DimensionId) ? "text-chart-3" : (
                    "text-chart-1"
                  ),
                )}
              >
                {dimensionLabels[col] || metricLabels[col] || col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={i}
              className="border-b border-border/50 last:border-0 hover:bg-muted/30 transition-colors"
            >
              {columns.map((col) => (
                <td
                  key={col}
                  className={cn(
                    "px-4 py-3",
                    metrics.includes(col as MetricId) ?
                      "font-mono tabular-nums text-right"
                    : "font-medium",
                  )}
                >
                  {formatValue(col, row[col as keyof ReportResult])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =============================================================================
// Main Report Builder Component
// =============================================================================

export function ReportBuilder() {
  // Selection state
  const [selectedDimensions, setSelectedDimensions] = React.useState<
    DimensionId[]
  >(["status"]);
  const [selectedMetrics, setSelectedMetrics] = React.useState<MetricId[]>([
    "totalEvents",
    "totalAmount",
  ]);
  const [groupBy, setGroupBy] = React.useState<DimensionId>("status");

  // Date filter state
  const [startDate, setStartDate] = React.useState<string>("");
  const [endDate, setEndDate] = React.useState<string>("");

  // Query state
  const [data, setData] = React.useState<ReportResult[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [hasQueried, setHasQueried] = React.useState(false);

  // Toggle handlers
  const toggleDimension = (id: DimensionId) => {
    setSelectedDimensions((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  };

  const toggleMetric = (id: MetricId) => {
    setSelectedMetrics((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  };

  // Run query
  const runQuery = async () => {
    setLoading(true);
    setHasQueried(true);

    const params: ReportParams = {
      dimensions: selectedDimensions,
      metrics: selectedMetrics,
      groupBy: groupBy,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    };

    try {
      const result = await getReport(params);
      setData(result);
    } catch (err) {
      console.error("Query failed:", err);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  const canQuery = selectedDimensions.length > 0 || selectedMetrics.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-chart-1 to-chart-3 text-white">
          <TrendingUp className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Report Builder</h2>
          <p className="text-sm text-muted-foreground">
            Build custom reports by selecting dimensions and metrics
          </p>
        </div>
      </div>

      {/* Configuration Panel */}
      <div className="rounded-xl border bg-card p-6 space-y-6">
        {/* Dimensions */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-chart-3">
            <LayoutGrid className="size-4" />
            <span>Dimensions</span>
            <span className="text-xs font-normal text-muted-foreground">
              (group & filter by)
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {DIMENSIONS.map((dim) => (
              <ToggleChip
                key={dim.id}
                label={dim.label}
                description={dim.description}
                selected={selectedDimensions.includes(dim.id)}
                onClick={() => toggleDimension(dim.id)}
                variant="dimension"
              />
            ))}
          </div>
        </div>

        {/* Metrics */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-chart-1">
            <BarChart3 className="size-4" />
            <span>Metrics</span>
            <span className="text-xs font-normal text-muted-foreground">
              (aggregate values)
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {METRICS.map((metric) => (
              <ToggleChip
                key={metric.id}
                label={metric.label}
                description={metric.description}
                selected={selectedMetrics.includes(metric.id)}
                onClick={() => toggleMetric(metric.id)}
                variant="metric"
              />
            ))}
          </div>
        </div>

        {/* Group By & Date Range */}
        <div className="flex flex-wrap items-end gap-4 pt-2 border-t border-border/50">
          {/* Group By */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <LayoutGrid className="size-3" />
              Group By
            </label>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as DimensionId)}
              className="h-9 px-3 rounded-md border border-input bg-background text-sm shadow-xs focus:border-ring focus:ring-2 focus:ring-ring/50 outline-none"
            >
              {DIMENSIONS.map((dim) => (
                <option key={dim.id} value={dim.id}>
                  {dim.label}
                </option>
              ))}
            </select>
          </div>

          {/* Date Range */}
          <div className="flex items-end gap-2">
            <DatePickerInput
              id="report-start-date"
              label={
                <span className="flex items-center gap-1.5">
                  <Calendar className="size-3" />
                  From
                </span>
              }
              value={startDate}
              onChange={setStartDate}
              placeholder="Start date"
              className="w-[160px]"
            />
            <DatePickerInput
              id="report-end-date"
              label="To"
              value={endDate}
              onChange={setEndDate}
              placeholder="End date"
              className="w-[160px]"
            />
          </div>

          {/* Spacer + Run Button */}
          <div className="flex-1" />
          <Button
            onClick={runQuery}
            disabled={!canQuery || loading}
            className="min-w-[120px] gap-2"
          >
            {loading ?
              <>
                <Loader2 className="size-4 animate-spin" />
                Running...
              </>
            : <>
                <Play className="size-4" />
                Run Query
              </>
            }
          </Button>
        </div>
      </div>

      {/* Results */}
      {hasQueried && (
        <div className="rounded-xl border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <TableIcon className="size-4 text-muted-foreground" />
              Results
              {data.length > 0 && (
                <span className="text-xs text-muted-foreground font-normal">
                  ({data.length} row{data.length !== 1 ? "s" : ""})
                </span>
              )}
            </h3>
          </div>

          {loading ?
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="size-8 animate-spin" />
            </div>
          : <ResultsTable
              data={data}
              dimensions={selectedDimensions}
              metrics={selectedMetrics}
            />
          }
        </div>
      )}
    </div>
  );
}
