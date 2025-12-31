import { Button } from "@/components/ui/button";
import { RefreshCwIcon } from "lucide-react";
import { DateFilterProvider } from "@/components/dashboard-date-context";
import { FilterBar } from "@/components/filter-bar";
import { DashboardCharts } from "@/components/dashboard-charts";
import { DashboardStats } from "@/components/dashboard-stats";
import { ThemeToggle } from "@/components/theme-toggle";

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
              <ThemeToggle />
              <Button variant="outline">
                <RefreshCwIcon />
                Refresh
              </Button>
            </div>
          </div>

          {/* Filter Bar */}
          <FilterBar />

          {/* Stats Grid */}
          <DashboardStats />

          {/* Charts */}
          <DashboardCharts />
        </div>
      </div>
    </DateFilterProvider>
  );
}
