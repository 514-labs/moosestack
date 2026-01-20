"use client";

import * as React from "react";
import {
  DashboardProvider,
  FilterBar,
  useMetrics,
  useEventsByStatus,
  EventsOverTimeChart,
} from "@/components/dashboard";
import { StatsCards, type StatItem } from "@/components/stats-cards";
import { DonutChart } from "@/components/charts";
import { type ChartConfig } from "@/components/ui/chart";
import { type MetricsResult } from "@/app/actions";
import {
  ActivityIcon,
  DollarSignIcon,
  CalculatorIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  PercentIcon,
  ChartLine,
  type LucideIcon,
} from "lucide-react";

// =============================================================================
// Chart Configuration
// =============================================================================

const statusChartConfig = {
  completed: { label: "Completed", color: "var(--chart-1)" },
  active: { label: "Active", color: "var(--chart-2)" },
  inactive: { label: "Inactive", color: "var(--chart-3)" },
} satisfies ChartConfig;

// =============================================================================
// Stats Card Configuration
// =============================================================================

interface MetricCardConfig {
  title: string;
  icon: LucideIcon;
  description?: string;
  format?: (value: number) => string | number;
}

const metricCards: Record<keyof MetricsResult, MetricCardConfig> = {
  totalEvents: {
    title: "Total Events",
    icon: ActivityIcon,
    description: "All events in period",
  },
  totalAmount: {
    title: "Total Amount",
    icon: DollarSignIcon,
    format: (v) => `$${v.toLocaleString()}`,
  },
  avgAmount: {
    title: "Average Amount",
    icon: CalculatorIcon,
    format: (v) => `$${v.toFixed(2)}`,
  },
  minAmount: {
    title: "Min Amount",
    icon: TrendingDownIcon,
    format: (v) => `$${v.toLocaleString()}`,
  },
  maxAmount: {
    title: "Max Amount",
    icon: TrendingUpIcon,
    format: (v) => `$${v.toLocaleString()}`,
  },
  highValueRatio: {
    title: "High Value Ratio",
    icon: PercentIcon,
    format: (v) => `${(v * 100).toFixed(1)}%`,
  },
};

const displayMetrics: (keyof MetricsResult)[] = [
  "totalEvents",
  "totalAmount",
  "avgAmount",
  "highValueRatio",
];

// =============================================================================
// Dashboard Content
// =============================================================================

function DashboardContent() {
  const { data: metrics, isLoading: metricsLoading } = useMetrics();
  const { data: eventsByStatus = [] } = useEventsByStatus();

  const stats: StatItem[] = React.useMemo(() => {
    if (!metrics) return [];
    return displayMetrics.map((key) => {
      const config = metricCards[key];
      const value = metrics[key];
      return {
        title: config.title,
        value: config.format ? config.format(value) : value,
        icon: config.icon,
        description: config.description,
        isPositive: value > 0,
      };
    });
  }, [metrics]);

  return (
    <>
      <StatsCards stats={stats} isLoading={metricsLoading || !metrics} />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <EventsOverTimeChart />
        <DonutChart
          data={eventsByStatus}
          chartConfig={statusChartConfig}
          title="Events by Status"
          icon={
            <ChartLine className="size-4 sm:size-[18px] text-muted-foreground" />
          }
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
