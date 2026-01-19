"use client";

import * as React from "react";
import {
  ActivityIcon,
  TrendingUpIcon,
  CheckCircleIcon,
  DollarSignIcon,
} from "lucide-react";
import { useDateFilter, useMetrics } from "@/lib/hooks";
import { StatsCards, type StatItem } from "@/components/dashboard";

export function DashboardStats(): React.ReactElement {
  const { startDate, endDate } = useDateFilter();

  const { data: metrics, isLoading } = useMetrics(startDate, endDate);

  const stats: StatItem[] =
    metrics ?
      [
        {
          title: "Total Events",
          value: metrics.totalEvents,
          isPositive: metrics.totalEvents > 0,
          description: "vs Last Months",
          icon: ActivityIcon,
          change: "+10%",
        },
        {
          title: "Active Events",
          value: metrics.activeEvents,
          isPositive: metrics.activeEvents > 0,
          description: "vs Last Months",
          icon: TrendingUpIcon,
          change: "+10%",
        },
        {
          title: "Completed Events",
          value: metrics.completedEvents,
          isPositive: metrics.completedEvents > 0,
          change: "+10%",
          description: "vs Last Months",
          icon: CheckCircleIcon,
        },
        {
          title: "Total Revenue",
          value: metrics.revenue,
          isPositive: metrics.revenue > 0,
          change: "+10%",
          description: "vs Last Months",
          icon: DollarSignIcon,
        },
      ]
    : [];

  return <StatsCards stats={stats} isLoading={isLoading || !metrics} />;
}
