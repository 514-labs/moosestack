"use client";

/**
 * Dashboard Metric Cards
 *
 * Dashboard-specific metric cards that use the generic MetricCard component
 * with data from the dashboard hooks.
 */

import * as React from "react";
import {
  ActivityIcon,
  DollarSignIcon,
  CalculatorIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  PercentIcon,
  type LucideIcon,
} from "lucide-react";
import {
  MetricCard,
  MetricCardsContainer,
  MetricRow,
} from "@/components/widgets/metric-card";
import { useMetrics } from "./dashboard-hooks";
import { type MetricsResult } from "@/app/actions";

// =============================================================================
// Configuration
// =============================================================================

interface MetricConfig {
  title: string;
  icon: LucideIcon;
  description?: string;
  format?: (value: number) => string | number;
}

const metricConfigs: Record<keyof MetricsResult, MetricConfig> = {
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

// =============================================================================
// Dashboard Metric Cards
// =============================================================================

export interface DashboardMetricCardsProps {
  config?: Record<keyof MetricsResult, MetricConfig>;
  columns?: number;
}

// Helper to chunk array into rows
function chunk<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size),
  );
}

export function DashboardMetricCards({
  columns = 3,
  config = metricConfigs,
}: DashboardMetricCardsProps = {}) {
  const { data: metrics, isLoading } = useMetrics();

  if (isLoading || !metrics) {
    return (
      <MetricCardsContainer>
        <MetricRow>
          {Array.from({ length: columns }).map((_, i) => (
            <div key={i} className="animate-pulse space-y-3">
              <div className="h-4 w-20 bg-muted rounded" />
              <div className="h-8 w-32 bg-muted rounded" />
            </div>
          ))}
        </MetricRow>
      </MetricCardsContainer>
    );
  }

  const metricEntries = Object.entries(metrics);
  const rows = chunk(metricEntries, columns);

  return (
    <MetricCardsContainer>
      {rows.map((row, rowIndex) => (
        <MetricRow key={rowIndex}>
          {row.map(([key, value]) => {
            const cfg = config[key as keyof MetricsResult];
            return (
              <MetricCard
                key={key}
                title={cfg.title}
                value={cfg.format ? cfg.format(value) : value}
                icon={cfg.icon}
                description={cfg.description}
              />
            );
          })}
        </MetricRow>
      ))}
    </MetricCardsContainer>
  );
}

// Re-export for backwards compatibility
export { DashboardMetricCards as MetricCards };
