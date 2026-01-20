import {
  prepareModel,
  type ReportQueryParams,
} from "@/components/report-builder";
import { statsModel } from "moose";
import { ReportPage } from "./report-page";
import { executeStatsQuery } from "./actions";

/**
 * Server Component: Prepare model and render client component.
 *
 * The new API is simple:
 * 1. Call prepareModel(queryModel, options) to convert model to serializable format
 * 2. Pass the model and execute function to a client component
 * 3. Use useReport hook in the client component
 */

// Prepare the model for the client (one simple function call)
const model = prepareModel(statsModel, {
  // Filter overrides (only needed for select options)
  filters: {
    status: {
      inputType: "select",
      options: [
        { value: "active", label: "Active" },
        { value: "completed", label: "Completed" },
        { value: "inactive", label: "Inactive" },
      ],
    },
  },
  // Optional: Override labels
  metrics: {
    highValueRatio: { label: "High Value %" },
  },
});

// Server action wrapper to adapt ReportQueryParams to statsModel types
async function executeQuery(params: ReportQueryParams) {
  "use server";
  return executeStatsQuery({
    dimensions: params.dimensions as ("status" | "day" | "month")[],
    metrics: params.metrics as (
      | "totalEvents"
      | "totalAmount"
      | "avgAmount"
      | "minAmount"
      | "maxAmount"
      | "highValueRatio"
    )[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filters: params.filters as any,
  });
}

export default function StatsReportPage() {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">04-Aggregations Report Builder</h1>
          <p className="text-muted-foreground">
            Build custom reports by selecting breakdown dimensions and metrics
          </p>
        </div>

        {/* Pass model and execute function to client component */}
        <ReportPage model={model} executeQuery={executeQuery} />
      </div>
    </div>
  );
}
