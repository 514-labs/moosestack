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

const defaultDisplayMetrics: (keyof MetricsResult)[] = [
  "totalEvents",
  "totalAmount",
  "avgAmount",
  "highValueRatio",
];

// =============================================================================
// Dashboard Metric Cards
// =============================================================================

export interface DashboardMetricCardsProps {
  displayMetrics?: (keyof MetricsResult)[];
}

export function DashboardMetricCards({
  displayMetrics = defaultDisplayMetrics,
}: DashboardMetricCardsProps = {}) {
  const { data: metrics, isLoading } = useMetrics();

  return (
    <MetricCardsContainer
      isLoading={isLoading || !metrics}
      skeletonCount={displayMetrics.length}
    >
      {metrics &&
        displayMetrics.map((key, index) => {
          const config = metricConfigs[key];
          const value = metrics[key];
          return (
            <MetricCard
              key={key}
              title={config.title}
              value={config.format ? config.format(value) : value}
              icon={config.icon}
              description={config.description}
              isPositive={value > 0}
              showDivider={index < displayMetrics.length - 1}
            />
          );
        })}
    </MetricCardsContainer>
  );
}

// Re-export for backwards compatibility
export { DashboardMetricCards as MetricCards };
