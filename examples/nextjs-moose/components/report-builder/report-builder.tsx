"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { DatePickerInput } from "@/components/date-picker-input";
import {
  LayoutGrid,
  BarChart3,
  RefreshCw,
  Loader2,
  TableIcon,
  TrendingUp,
  Calendar,
  AlertCircle,
} from "lucide-react";
import { ToggleChip } from "./toggle-chip";
import { ResultsTable } from "./results-table";
import type { ReportBuilderConfig, ReportQueryParams } from "./types";

export type ReportBuilderProps<
  TDimension extends string = string,
  TMetric extends string = string,
  TResult extends Record<string, unknown> = Record<string, unknown>,
> = ReportBuilderConfig<TDimension, TMetric, TResult>;

export function ReportBuilder<
  TDimension extends string,
  TMetric extends string,
  TResult extends Record<string, unknown>,
>({
  dimensions,
  metrics,
  execute,
  title = "Report Builder",
  description = "Build custom reports by selecting dimensions and metrics",
  defaultDimensions,
  defaultMetrics,
  defaultGroupBy,
  showDateFilter = true,
  showGroupBy = true,
}: ReportBuilderProps<TDimension, TMetric, TResult>) {
  // Build label maps for the results table
  const dimensionLabels = React.useMemo(
    () =>
      dimensions.reduce(
        (acc, d) => ({ ...acc, [d.id]: d.label }),
        {} as Record<TDimension, string>,
      ),
    [dimensions],
  );
  const metricLabels = React.useMemo(
    () =>
      metrics.reduce(
        (acc, m) => ({ ...acc, [m.id]: m.label }),
        {} as Record<TMetric, string>,
      ),
    [metrics],
  );

  // Form state (UI selections)
  const [selectedDimensions, setSelectedDimensions] = React.useState<
    TDimension[]
  >(defaultDimensions ?? (dimensions[0] ? [dimensions[0].id] : []));

  const [selectedMetrics, setSelectedMetrics] = React.useState<TMetric[]>(
    defaultMetrics ?? metrics.slice(0, 2).map((m) => m.id),
  );

  const [groupBy, setGroupBy] = React.useState<TDimension>(
    defaultGroupBy ?? dimensions[0]?.id ?? ("" as TDimension),
  );

  const [startDate, setStartDate] = React.useState<string>("");
  const [endDate, setEndDate] = React.useState<string>("");

  // Build query params from form state
  const queryParams: ReportQueryParams<TDimension, TMetric> = React.useMemo(
    () => ({
      dimensions: selectedDimensions,
      metrics: selectedMetrics,
      groupBy: groupBy,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
    [selectedDimensions, selectedMetrics, groupBy, startDate, endDate],
  );

  // Check if we can run a query
  const canQuery = selectedDimensions.length > 0 || selectedMetrics.length > 0;

  // Query - automatically refetches when queryParams change
  const {
    data,
    isLoading: loading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ["report", queryParams],
    queryFn: () => execute(queryParams),
    enabled: canQuery, // Only run when there's something to query
  });

  // Toggle handlers
  const toggleDimension = (id: TDimension) => {
    setSelectedDimensions((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id],
    );
  };

  const toggleMetric = (id: TMetric) => {
    setSelectedMetrics((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id],
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-gradient-to-br from-chart-1 to-chart-3 text-white">
          <TrendingUp className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
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
            {dimensions.map((dim) => (
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
            {metrics.map((metric) => (
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
          {showGroupBy && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                <LayoutGrid className="size-3" />
                Group By
              </label>
              <select
                value={groupBy}
                onChange={(e) => setGroupBy(e.target.value as TDimension)}
                className="h-9 px-3 rounded-md border border-input bg-background text-sm shadow-xs focus:border-ring focus:ring-2 focus:ring-ring/50 outline-none"
              >
                {dimensions.map((dim) => (
                  <option key={dim.id} value={dim.id}>
                    {dim.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Date Range */}
          {showDateFilter && (
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
          )}

          {/* Spacer + Refresh Button */}
          <div className="flex-1" />
          <Button
            onClick={() => refetch()}
            disabled={!canQuery || loading}
            variant="outline"
            className="min-w-[120px] gap-2"
          >
            {isFetching ?
              <>
                <Loader2 className="size-4 animate-spin" />
                Refreshing...
              </>
            : <>
                <RefreshCw className="size-4" />
                Refresh
              </>
            }
          </Button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 p-4">
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle className="size-4" />
            <span className="font-medium">Query failed</span>
          </div>
          <p className="mt-1 text-sm text-destructive/80">
            {error instanceof Error ? error.message : "An error occurred"}
          </p>
        </div>
      )}

      {/* Results */}
      {canQuery && (
        <div className="rounded-xl border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <TableIcon className="size-4 text-muted-foreground" />
              Results
              {data && data.length > 0 && (
                <span className="text-xs text-muted-foreground font-normal">
                  ({data.length} row{data.length !== 1 ? "s" : ""})
                </span>
              )}
              {isFetching && !loading && (
                <Loader2 className="size-3 animate-spin text-muted-foreground" />
              )}
            </h3>
          </div>

          {loading ?
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="size-8 animate-spin" />
            </div>
          : <ResultsTable
              data={data ?? []}
              dimensions={selectedDimensions}
              metrics={selectedMetrics}
              dimensionLabels={dimensionLabels}
              metricLabels={metricLabels}
            />
          }
        </div>
      )}
    </div>
  );
}
