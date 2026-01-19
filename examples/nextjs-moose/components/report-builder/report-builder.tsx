"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  LayoutGrid,
  BarChart3,
  RefreshCw,
  Loader2,
  TableIcon,
  TrendingUp,
  AlertCircle,
} from "lucide-react";
import {
  DateRangeInput,
  MultiSelectChips,
  type FieldOption,
} from "@/components/inputs";
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
  defaultBreakdown,
  defaultMetrics,
  showDateFilter = true,
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

  // Build dataKey map for columns with different data keys (e.g., snake_case)
  const dataKeyMap = React.useMemo(() => {
    const map: Record<string, string> = {};
    for (const d of dimensions) {
      if (d.dataKey) map[d.id] = d.dataKey;
    }
    for (const m of metrics) {
      if (m.dataKey) map[m.id] = m.dataKey;
    }
    return map;
  }, [dimensions, metrics]);

  // Convert FieldMeta to FieldOption for inputs
  const dimensionOptions: readonly FieldOption<TDimension>[] = dimensions;
  const metricOptions: readonly FieldOption<TMetric>[] = metrics;

  // Form state (UI selections)
  const [breakdown, setBreakdown] = React.useState<TDimension[]>(
    defaultBreakdown ?? (dimensions[0] ? [dimensions[0].id] : []),
  );

  const [selectedMetrics, setSelectedMetrics] = React.useState<TMetric[]>(
    defaultMetrics ?? metrics.slice(0, 2).map((m) => m.id),
  );

  const [startDate, setStartDate] = React.useState<string>("");
  const [endDate, setEndDate] = React.useState<string>("");

  // Build query params from form state
  const queryParams: ReportQueryParams<TDimension, TMetric> = React.useMemo(
    () => ({
      breakdown: breakdown,
      metrics: selectedMetrics,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    }),
    [breakdown, selectedMetrics, startDate, endDate],
  );

  // Check if we can run a query
  const canQuery = breakdown.length > 0 || selectedMetrics.length > 0;

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
        {/* Metrics */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-chart-1">
            <BarChart3 className="size-4" />
            <span>Metrics</span>
            <span className="text-xs font-normal text-muted-foreground">
              (aggregate values)
            </span>
          </div>
          <MultiSelectChips
            options={metricOptions}
            selected={selectedMetrics}
            onChange={setSelectedMetrics}
            variant="primary"
          />
        </div>
        {/* Breakdown (dimensions to group by) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-chart-3">
            <LayoutGrid className="size-4" />
            <span>Breakdown</span>
            <span className="text-xs font-normal text-muted-foreground">
              (segment data by)
            </span>
          </div>
          <MultiSelectChips
            options={dimensionOptions}
            selected={breakdown}
            onChange={setBreakdown}
            variant="secondary"
          />
        </div>

        {/* Date Range & Refresh */}
        <div className="flex flex-wrap items-end gap-4 pt-4 border-t border-border/50">
          {/* Date Range */}
          {showDateFilter && (
            <DateRangeInput
              startDate={startDate}
              endDate={endDate}
              onChange={({ start, end }) => {
                setStartDate(start);
                setEndDate(end);
              }}
              showPresets={true}
              presetLabel="Date Range"
              startLabel="From"
              endLabel="To"
              inputWidth="w-[140px]"
            />
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
              dimensions={breakdown}
              metrics={selectedMetrics}
              dimensionLabels={dimensionLabels}
              metricLabels={metricLabels}
              dataKeyMap={dataKeyMap}
            />
          }
        </div>
      )}
    </div>
  );
}
