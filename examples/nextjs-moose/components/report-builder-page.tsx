"use client";

/**
 * Client Component: Report Builder UI using useReport hook.
 *
 * This demonstrates the new hook-based API:
 * - report.model: Access model metadata (dimensions, metrics, filters)
 * - report.state: Current selections (which dims/metrics are selected, filter values)
 * - report.actions: Functions to modify state (toggle, setFilter, etc.)
 * - report.query: Query execution state (data, loading, error)
 */

import {
  useReport,
  DimensionChips,
  MetricChips,
  FilterRow,
  ExecuteButton,
  SimpleResultsTable,
  type ReportModel,
  type QueryRequest,
  FilterValue,
} from "@/components/report-builder";

interface ReportBuilderPageProps {
  model: ReportModel;
  executeQuery: (params: QueryRequest) => Promise<unknown[]>;
  defaults: {
    dimensions?: string[];
    metrics?: string[];
    filters?: Record<string, FilterValue>;
  };
}

export function ReportBuilderPage({
  model,
  executeQuery,
  defaults,
}: ReportBuilderPageProps) {
  // The hook gives you everything you need
  const report = useReport({
    model,
    execute: executeQuery,
    defaults: {
      dimensions: defaults.dimensions ?? [],
      metrics: defaults.metrics ?? [],
      filters: defaults.filters ?? {},
    },
  });

  return (
    <div className="space-y-6">
      {/* Configuration Panel */}
      <div className="rounded-xl border bg-card p-6 space-y-6">
        {/* Metrics & Dimensions - Using provided components */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <MetricChips
            options={report.model.metrics}
            selected={report.state.metrics}
            onToggle={report.actions.toggleMetric}
          />
          <DimensionChips
            options={report.model.dimensions}
            selected={report.state.dimensions}
            onToggle={report.actions.toggleDimension}
          />
        </div>

        {/* Filters - Using FilterRow component */}
        <div className="space-y-4 pt-4 border-t border-border/50">
          <div className="text-sm font-semibold">Filters</div>
          <div className="space-y-3">
            {report.model.filters.map((filter) => (
              <FilterRow
                key={filter.id}
                filter={filter}
                value={report.state.filters[filter.id]}
                onChange={(op, val) =>
                  report.actions.setFilter(filter.id, op, val)
                }
                onClear={() => report.actions.clearFilter(filter.id)}
              />
            ))}
          </div>
        </div>

        {/* Execute Button */}
        <div className="flex justify-end pt-4 border-t border-border/50">
          <ExecuteButton
            onClick={report.actions.execute}
            isLoading={report.query.isLoading || report.query.isFetching}
            label="Refresh"
          />
        </div>
      </div>

      {/* Results */}
      {report.query.error && (
        <div className="rounded-xl border border-destructive bg-destructive/10 p-4 text-destructive">
          Error: {report.query.error.message}
        </div>
      )}

      {report.query.data && (
        <div className="rounded-xl border bg-card p-6">
          <h3 className="font-semibold mb-4">
            Results ({report.query.data.length} rows)
          </h3>
          <SimpleResultsTable
            data={report.query.data}
            dimensions={report.state.dimensions}
            metrics={report.state.metrics}
            model={report.model}
          />
        </div>
      )}

      {/* Debug: Show current state (helpful for understanding the API) */}
      <details className="rounded-xl border bg-muted/50 p-4">
        <summary className="cursor-pointer font-medium text-sm">
          Debug: Current State
        </summary>
        <pre className="mt-4 text-xs overflow-auto">
          {JSON.stringify(
            {
              "report.state.dimensions": report.state.dimensions,
              "report.state.metrics": report.state.metrics,
              "report.state.filters": report.state.filters,
              "report.query.isLoading": report.query.isLoading,
              "report.query.data?.length": report.query.data?.length,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}
