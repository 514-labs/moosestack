"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MetricCard } from "./metric-card";

interface RegionRevenue {
  region: string;
  revenue: number;
}

// Tooltip content mirrors the query model definition in
// packages/moosestack-service/app/query-models/transaction-metrics.ts
const METRIC_REVENUE = `query_transaction_metrics
metric: revenue
  sumIf(totalAmount, status = 'completed')
dimension: region
orderBy: revenue DESC`;

const METRIC_TOP_REGION = `query_transaction_metrics
metric: revenue
  sumIf(totalAmount, status = 'completed')
dimension: region
orderBy: revenue DESC
limit: 1`;

const METRIC_REGION_COUNT = `query_transaction_metrics
metric: regionCount
  uniqExactIf(region, status = 'completed')`;

export function RevenueDashboard() {
  const [data, setData] = useState<RegionRevenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchRevenue() {
      try {
        const res = await fetch("http://localhost:4000/revenue/by-region");
        const json = await res.json();
        if (json.success) {
          setData(json.data);
        } else {
          setError(json.error);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to fetch");
      } finally {
        setLoading(false);
      }
    }

    fetchRevenue();
    const interval = setInterval(fetchRevenue, 15_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-32 rounded-lg border bg-card animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load revenue: {error}
      </div>
    );
  }

  const totalRevenue = data.reduce((sum, d) => sum + d.revenue, 0);
  const topRegion = data[0];

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          title="Total Revenue"
          value={formatCurrency(totalRevenue)}
          sql={METRIC_REVENUE}
          subtitle="Completed transactions, all regions"
        />
        {topRegion && (
          <MetricCard
            title="Top Region"
            value={topRegion.region}
            sql={METRIC_TOP_REGION}
            subtitle={formatCurrency(topRegion.revenue)}
          />
        )}
        <MetricCard
          title="Regions"
          value={data.length.toString()}
          sql={METRIC_REGION_COUNT}
          subtitle="With completed transactions"
        />
      </div>

      <div className="rounded-lg border bg-card">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold">Revenue by Region</h3>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-4 w-4 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-sm">
              <pre className="text-xs font-mono whitespace-pre-wrap">
                {METRIC_REVENUE}
              </pre>
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="divide-y">
          {data.map((row) => (
            <div
              key={row.region}
              className="flex items-center justify-between px-4 py-3"
            >
              <span className="text-sm font-medium">{row.region}</span>
              <div className="flex items-center gap-3">
                <div className="w-32 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${(row.revenue / (data[0]?.revenue || 1)) * 100}%`,
                    }}
                  />
                </div>
                <span className="text-sm tabular-nums text-muted-foreground w-28 text-right">
                  {formatCurrency(row.revenue)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
