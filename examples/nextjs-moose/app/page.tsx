import { DateFilterProvider } from "@/components/dashboard";
import { FilterBar } from "@/components/dashboard";
import { DashboardCharts } from "@/components/dashboard-charts";
import { DashboardStats } from "@/components/dashboard-stats";

export default function Page() {
  return (
    <DateFilterProvider>
      <div className="p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          {/* Header */}
          <div>
            <h1 className="text-3xl font-bold">Dashboard</h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Overview of your data and metrics
            </p>
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
