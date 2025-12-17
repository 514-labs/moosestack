import { getOverviewMetrics } from "@/moose";
import { DashboardLayout } from "@/components/dashboard-layout";
import { MetricCard } from "@/components/metric-card";
import { TimeFilter } from "@/components/time-filter";
import { getDateRange } from "@/lib/date-utils";
import { DollarSign, ShoppingCart, Users } from "lucide-react";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: { range?: string };
}) {
  const dateRange = getDateRange(searchParams?.range || null);
  const { totalRevenue, totalSales, activeNow } =
    await getOverviewMetrics(dateRange);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat("en-US").format(value);
  };

  return (
    <DashboardLayout>
      <div className="p-8">
        <header className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-3xl font-semibold">Analytics</h1>
            <p className="text-muted-foreground mt-2">
              Detailed analytics and insights
            </p>
          </div>
          <TimeFilter />
        </header>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <MetricCard
            title="Total Revenue"
            value={formatCurrency(totalRevenue)}
            icon={DollarSign}
            trend={{ value: "+12.5%", isPositive: true }}
          />
          <MetricCard
            title="Total Sales"
            value={formatNumber(totalSales)}
            icon={ShoppingCart}
            trend={{ value: "+8.2%", isPositive: true }}
          />
          <MetricCard
            title="Active Users"
            value={formatNumber(activeNow)}
            icon={Users}
            trend={{ value: "+5.1%", isPositive: true }}
          />
        </div>
      </div>
    </DashboardLayout>
  );
}
