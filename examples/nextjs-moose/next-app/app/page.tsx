import { Button } from "@/components/ui/button";
import { RefreshCwIcon } from "lucide-react";
import { DateFilterProvider } from "@/components/dashboard-date-context";
import { DashboardDateFilter } from "@/components/dashboard-with-filters";
import { TimeSeriesChart } from "@/components/time-series-chart";
import { PieChart } from "@/components/pie-chart";
import { SeedButton } from "@/components/seed-button";
import { DashboardStats } from "@/components/dashboard-stats";

export default function Page() {
  return (
    <DateFilterProvider>
      <div className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Dashboard</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Overview of your data and metrics
              </p>
            </div>
            <div className="flex items-center gap-2">
              <SeedButton />
              <Button variant="outline">
                <RefreshCwIcon />
                Refresh
              </Button>
            </div>
          </div>

          {/* Date Filter Bar */}
          <DashboardDateFilter />

          {/* Stats Grid */}
          <DashboardStats />

          {/* Main Content Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {/* Time Series Chart */}
            <div className="lg:col-span-2">
              <TimeSeriesChart />
            </div>

            {/* Events by Status Pie Chart */}
            <PieChart />
          </div>
        </div>
      </div>
    </DateFilterProvider>
  );
}
