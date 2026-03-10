"use client";

import { useQuery } from "@tanstack/react-query";
import { useReport } from "./use-report";
import {
  DimensionChips,
  MetricChips,
  FilterControls,
  SimpleResultsTable,
  ResultsChart,
  QueryStatus,
} from "./components";
import { executeQuery, fetchSchema } from "@/app/actions";
import type { QueryRequest, ReportModel } from "./types";
import { Loader2 } from "lucide-react";

export function ReportBuilder() {
  const schema = useQuery({
    queryKey: ["transaction-schema"],
    queryFn: () => fetchSchema(),
  });

  if (schema.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
        <Loader2 className="size-4 animate-spin" />
        Loading schema...
      </div>
    );
  }

  if (schema.error || !schema.data) {
    return (
      <div className="text-sm text-destructive py-12 text-center">
        Failed to load schema: {schema.error?.message ?? "No data"}
      </div>
    );
  }

  return (
    <ReportBuilderInner
      model={{
        metrics: schema.data.metrics,
        dimensions: schema.data.dimensions,
        filters: schema.data.filters,
      }}
      defaultMetrics={schema.data.defaults.metrics}
    />
  );
}

function ReportBuilderInner({
  model,
  defaultMetrics,
}: {
  model: ReportModel;
  defaultMetrics?: string[];
}) {
  const report = useReport({
    model,
    execute: (params: QueryRequest) => executeQuery(params),
    defaults: {
      metrics: defaultMetrics ?? [
        "revenue",
        "totalTransactions",
        "completedTransactions",
      ],
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-4">
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
        <FilterControls
          filters={report.model.filters}
          values={report.state.filters}
          onSet={report.actions.setFilter}
          onClear={report.actions.clearFilter}
          onClearAll={report.actions.clearAllFilters}
        />
      </div>

      <QueryStatus isFetching={report.query.isFetching} />

      {report.query.error && (
        <div className="text-sm text-destructive">
          {report.query.error.message}
        </div>
      )}

      {report.state.metrics.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          Select at least one metric to query
        </div>
      )}

      {report.query.data && (
        <>
          <ResultsChart
            data={report.query.data}
            dimensions={report.state.dimensions}
            metrics={report.state.metrics}
            model={report.model}
          />
          <SimpleResultsTable
            data={report.query.data}
            dimensions={report.state.dimensions}
            metrics={report.state.metrics}
            model={report.model}
          />
        </>
      )}
    </div>
  );
}
