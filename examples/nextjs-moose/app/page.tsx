"use client";

import {
  DashboardProvider,
  FilterBar,
  useEventsByStatus,
  useMetrics,
  EventsOverTimeChart,
  MetricCards,
} from "@/components/dashboard";
import { DonutChart } from "@/components/widgets";
import { type ChartConfig } from "@/components/ui/chart";
import { ChartLine } from "lucide-react";

// =============================================================================
// Chart Configuration
// =============================================================================

const statusChartConfig = {
  completed: { label: "Completed", color: "var(--chart-1)" },
  active: { label: "Active", color: "var(--chart-2)" },
  inactive: { label: "Inactive", color: "var(--chart-3)" },
} satisfies ChartConfig;

// =============================================================================
// Dashboard Content
// =============================================================================

function DashboardContent() {
  const { data: metrics } = useMetrics();
  const { data: eventsByStatus = [] } = useEventsByStatus();

  return (
    <>
      <MetricCards />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <EventsOverTimeChart />
        <DonutChart
          data={eventsByStatus}
          chartConfig={statusChartConfig}
          title="Events by Status"
          centerValue={metrics?.totalEvents ?? 0}
          centerLabel="Total Events"
        />
      </div>
    </>
  );
}

// =============================================================================
// Page
// =============================================================================

export default function DashboardPage() {
  return (
    <DashboardProvider>
      <div className="p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Overview of your data and metrics
            </p>
          </div>

          <FilterBar />

          <DashboardContent />
        </div>
      </div>
    </DashboardProvider>
  );
}
