"use client";

import { useEffect, useState } from "react";
import { MetricCard } from "@/features/dashboard/metric-card";
import { CohortJourney } from "@/features/dashboard/cohort-journey";
import { CustomerSegments } from "@/features/dashboard/customer-segments";
import { ConversionSparkline } from "@/features/dashboard/conversion-sparkline";
import { Users, TrendingUp, DollarSign, Target } from "lucide-react";
import { analyticsApi, fetchApi } from "@/lib/api";

type Metrics = {
  emailsSent: number;
  openRate: number;
  clickRate: number;
  signups: number;
  conversionRate: number;
};

const defaultMetrics: Metrics = {
  emailsSent: 50000,
  openRate: 25,
  clickRate: 7.5,
  signups: 850,
  conversionRate: 1.7,
};

export default function Home() {
  const [metrics, setMetrics] = useState<Metrics>(defaultMetrics);

  useEffect(() => {
    fetchApi<Metrics>(analyticsApi.metrics)
      .then(setMetrics)
      .catch(() => setMetrics(defaultMetrics));
  }, []);

  return (
    <div className="flex-1 p-6 space-y-6 overflow-y-auto h-[calc(100vh-56px)]">
      {/* Header with Hero Conversion Metric */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Email → Signup → Purchase Journey Analytics
          </h1>
          <p className="text-muted-foreground">
            Track how email campaigns drive signups and purchases
          </p>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-3 justify-end">
            <div>
              <div className="text-3xl font-bold">
                {metrics.conversionRate}%
              </div>
              <div className="text-sm text-muted-foreground">
                Click → Signup
              </div>
            </div>
            <div className="border-l pl-4">
              <ConversionSparkline />
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards - Email Campaign Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Emails Sent"
          value={metrics.emailsSent.toLocaleString()}
          change="This period"
          changeType="neutral"
          icon={<Users className="h-4 w-4" />}
        />
        <MetricCard
          title="Open Rate"
          value={`${metrics.openRate}%`}
          change="+3.2% vs prior period"
          changeType="positive"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <MetricCard
          title="Click-to-Signup"
          value={`${metrics.conversionRate}%`}
          change="+0.3% vs prior period"
          changeType="positive"
          icon={<Target className="h-4 w-4" />}
        />
        <MetricCard
          title="New Signups"
          value={metrics.signups.toLocaleString()}
          change={`$${(metrics.signups * 150).toLocaleString()} revenue`}
          changeType="positive"
          icon={<DollarSign className="h-4 w-4" />}
        />
      </div>

      {/* Hero: Cohort Journey Table */}
      <CohortJourney />

      {/* Segments */}
      <CustomerSegments />
    </div>
  );
}
