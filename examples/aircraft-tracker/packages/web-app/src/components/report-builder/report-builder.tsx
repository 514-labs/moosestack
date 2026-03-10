"use client";

import { useReport } from "./use-report";
import {
  DimensionChips,
  MetricChips,
  FilterControls,
  SimpleResultsTable,
  QueryStatus,
} from "./components";
import { aircraftReportModel } from "./aircraft-model";
import { executeQuery } from "@/app/actions";
import type { QueryRequest } from "./types";

export function ReportBuilder() {
  const report = useReport({
    model: aircraftReportModel,
    execute: (params: QueryRequest) => executeQuery(params),
    defaults: {
      metrics: ["totalAircraft", "planesInAir", "planesOnGround"],
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
        <SimpleResultsTable
          data={report.query.data}
          dimensions={report.state.dimensions}
          metrics={report.state.metrics}
          model={report.model}
        />
      )}
    </div>
  );
}
