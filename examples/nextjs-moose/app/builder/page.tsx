import { prepareModel } from "@/components/report-builder";
import { eventsModel } from "moose";
import { ReportBuilderPage } from "@/components/report-builder-page";
import { executeEventsQuery } from "@/app/actions";

// Prepare the model for the client (one simple function call)
const model = prepareModel(eventsModel, {
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

const defaults = {
  dimensions: ["status"],
  metrics: ["totalEvents", "totalAmount"],
  filters: {},
};

export default function BuilderPage() {
  return (
    <div className="p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Events Report Builder</h1>
          <p className="text-muted-foreground">
            Build custom reports by selecting breakdown dimensions and metrics
          </p>
        </div>

        {/* Pass model and execute function to client component */}
        <ReportBuilderPage
          model={model}
          executeQuery={executeEventsQuery}
          defaults={defaults}
        />
      </div>
    </div>
  );
}
