"use client";

import { useEffect, useState } from "react";
import { analyticsApi, fetchApi, type ConversionTrendPoint } from "@/lib/api";

function Sparkline({
  data,
  width = 80,
  height = 24,
}: {
  data: number[];
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((value, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke="#10b981"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ConversionSparkline() {
  const [data, setData] = useState<ConversionTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchApi<ConversionTrendPoint[]>(analyticsApi.conversionTrend)
      .then(setData)
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <span className="text-muted-foreground text-sm">Loading...</span>;
  }

  if (data.length === 0) {
    return <span className="text-muted-foreground text-sm">No data</span>;
  }

  const rates = data.map((d) => d.rate);
  const latest = rates[rates.length - 1] ?? 0;
  const previous = rates[rates.length - 2] ?? 0;
  const trend = latest - previous;
  const trendPercent =
    previous > 0 ? ((trend / previous) * 100).toFixed(1) : "0";

  return (
    <div className="flex items-center gap-2">
      <Sparkline data={rates} />
      <span
        className={
          trend >= 0 ?
            "text-emerald-600 dark:text-emerald-400"
          : "text-red-600 dark:text-red-400"
        }
      >
        {trend >= 0 ? "+" : ""}
        {trendPercent}%
      </span>
      <span className="text-muted-foreground text-sm">vs last week</span>
    </div>
  );
}
