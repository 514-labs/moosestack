"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { InfoIcon } from "lucide-react";
import { analyticsApi, fetchApi, type CohortData } from "@/lib/api";
import { cn } from "@/lib/utils";

// Stage definitions with expected benchmarks for coloring
// Benchmarks represent "good" performance - colors are relative to these targets
// Full funnel: email audience → signup → engagement → purchase
// All benchmarks are % of original email audience
const stages = [
  {
    key: "entered" as const,
    label: "Signed Up",
    description: "From emails",
    benchmark: 5,
  }, // 5% signup rate is good
  {
    key: "engaged" as const,
    label: "Returning",
    description: "2+ sessions",
    benchmark: 2.5,
  }, // ~50% of signups
  {
    key: "active" as const,
    label: "Active",
    description: "10+ page views",
    benchmark: 1.5,
  }, // ~30% of signups
  {
    key: "converted" as const,
    label: "Purchased",
    description: "Completed order",
    benchmark: 0.5,
  }, // ~10% of signups
];

type Metrics = {
  emailsSent: number;
  openRate: number;
  clickRate: number;
  signups: number;
  conversionRate: number;
};

// Color based on performance relative to stage benchmark
// >= 100% of benchmark = excellent (green)
// >= 80% of benchmark = good (light green)
// >= 60% of benchmark = fair (yellow)
// >= 40% of benchmark = needs attention (orange)
// < 40% of benchmark = poor (red)
function getRateColor(rate: number, stageKey: string): string {
  const stage = stages.find((s) => s.key === stageKey);
  if (!stage) return "bg-slate-100 dark:bg-slate-800";

  const performanceRatio = rate / stage.benchmark;

  if (performanceRatio >= 1.0) return "bg-emerald-100 dark:bg-emerald-900/40";
  if (performanceRatio >= 0.8) return "bg-emerald-50 dark:bg-emerald-900/20";
  if (performanceRatio >= 0.6) return "bg-amber-50 dark:bg-amber-900/20";
  if (performanceRatio >= 0.4) return "bg-orange-50 dark:bg-orange-900/20";
  return "bg-red-50 dark:bg-red-900/20";
}

export function CohortJourney() {
  const [data, setData] = useState<CohortData[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchApi<CohortData[]>(analyticsApi.cohorts),
      fetchApi<Metrics>(analyticsApi.metrics),
    ])
      .then(([cohortData, metricsData]) => {
        setData(cohortData);
        setMetrics(metricsData);
      })
      .catch((err) => setError(err.message || "Failed to load data"))
      .finally(() => setLoading(false));
  }, []);

  // Calculate audience per cohort (total emails / number of cohorts)
  const audiencePerCohort =
    metrics && data.length > 0 ?
      Math.round(metrics.emailsSent / data.length)
    : 0;

  // Calculate totals
  const totalAudience = metrics?.emailsSent ?? 0;
  const totalConverted = data.reduce(
    (sum, c) => sum + c.stages.converted.count,
    0,
  );

  // Conversion rate relative to total email audience (consistent with table view)
  const avgConversion =
    totalAudience > 0 ?
      ((totalConverted / totalAudience) * 100).toFixed(2)
    : "0";

  return (
    <TooltipProvider>
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-xl flex items-center gap-2">
                Email Subscriber Journey by Cohort
                <Tooltip>
                  <TooltipTrigger>
                    <InfoIcon className="h-4 w-4 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    <p className="font-medium mb-2">Color Legend</p>
                    <p className="text-xs mb-2">
                      Colors show performance relative to expected % of
                      audience:
                    </p>
                    <ul className="text-xs space-y-1">
                      <li>
                        <span className="font-medium">Signed Up:</span> 5%
                        target
                      </li>
                      <li>
                        <span className="font-medium">Returning:</span> 2.5%
                        target
                      </li>
                      <li>
                        <span className="font-medium">Active:</span> 1.5% target
                      </li>
                      <li>
                        <span className="font-medium">Purchased:</span> 0.5%
                        target
                      </li>
                    </ul>
                    <p className="text-xs mt-2 text-muted-foreground">
                      Green = at/above target, Yellow = 60-80%, Red = below 40%
                    </p>
                  </TooltipContent>
                </Tooltip>
              </CardTitle>
              <CardDescription>
                Track how email-acquired signups progress from first visit to
                purchase
              </CardDescription>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold">{avgConversion}%</div>
              <div className="text-sm text-muted-foreground">
                Audience → Purchase
              </div>
            </div>
          </div>

          {/* Journey path visualization */}
          <div className="flex items-center gap-2 pt-4 text-sm">
            <div className="flex flex-col items-center">
              <span className="font-medium">Audience</span>
              <span className="text-xs text-muted-foreground">Emails sent</span>
            </div>
            <span className="mx-3 text-muted-foreground">→</span>
            {stages.map((stage, i) => (
              <div key={stage.key} className="flex items-center">
                <div className="flex flex-col items-center">
                  <span className="font-medium">{stage.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {stage.description}
                  </span>
                </div>
                {i < stages.length - 1 && (
                  <span className="mx-3 text-muted-foreground">→</span>
                )}
              </div>
            ))}
          </div>
        </CardHeader>

        <CardContent>
          {loading ?
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              Loading...
            </div>
          : error ?
            <div className="flex items-center justify-center h-[300px] text-destructive">
              {error}
            </div>
          : data.length === 0 ?
            <div className="flex items-center justify-center h-[300px] text-muted-foreground">
              No cohort data available
            </div>
          : <>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-2 font-medium text-sm">
                        Cohort
                      </th>
                      <th className="text-center py-3 px-2 font-medium text-sm min-w-[100px]">
                        Audience
                      </th>
                      {stages.map((stage) => (
                        <th
                          key={stage.key}
                          className="text-center py-3 px-2 font-medium text-sm min-w-[100px]"
                        >
                          {stage.label}
                        </th>
                      ))}
                      <th className="text-right py-3 px-2 font-medium text-sm">
                        Revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((cohort) => {
                      // Calculate signup rate relative to audience
                      const signupRate =
                        audiencePerCohort > 0 ?
                          ((cohort.size / audiencePerCohort) * 100).toFixed(1)
                        : "0";

                      return (
                        <tr
                          key={cohort.cohort}
                          className="border-b border-border/50 hover:bg-muted/30"
                        >
                          <td className="py-3 px-2">
                            <div className="font-medium">{cohort.cohort}</div>
                          </td>
                          {/* Audience column */}
                          <td className="py-2 px-1">
                            <div className="rounded-md py-2 px-3 text-center bg-slate-100 dark:bg-slate-800">
                              <div className="font-semibold tabular-nums">
                                100%
                              </div>
                              <div className="text-xs text-muted-foreground tabular-nums">
                                {audiencePerCohort.toLocaleString()}
                              </div>
                            </div>
                          </td>
                          {/* Signed Up - rate is relative to audience */}
                          <td className="py-2 px-1">
                            <div
                              className={cn(
                                "rounded-md py-2 px-3 text-center transition-colors",
                                getRateColor(parseFloat(signupRate), "entered"),
                              )}
                            >
                              <div className="font-semibold tabular-nums">
                                {signupRate}%
                              </div>
                              <div className="text-xs text-muted-foreground tabular-nums">
                                {cohort.size.toLocaleString()}
                              </div>
                            </div>
                          </td>
                          {/* Remaining stages - rate is relative to audience */}
                          {stages.slice(1).map((stage) => {
                            const stageData = cohort.stages[stage.key];
                            // Calculate rate relative to audience, not signups
                            const rateVsAudience =
                              audiencePerCohort > 0 ?
                                (
                                  (stageData.count / audiencePerCohort) *
                                  100
                                ).toFixed(1)
                              : "0";
                            return (
                              <td key={stage.key} className="py-2 px-1">
                                <div
                                  className={cn(
                                    "rounded-md py-2 px-3 text-center transition-colors",
                                    getRateColor(
                                      parseFloat(rateVsAudience),
                                      stage.key,
                                    ),
                                  )}
                                >
                                  <div className="font-semibold tabular-nums">
                                    {rateVsAudience}%
                                  </div>
                                  <div className="text-xs text-muted-foreground tabular-nums">
                                    {stageData.count.toLocaleString()}
                                  </div>
                                </div>
                              </td>
                            );
                          })}
                          <td className="text-right py-3 px-2 tabular-nums font-medium">
                            ${cohort.revenue.toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 mt-4 pt-4 border-t text-xs text-muted-foreground">
                <span>vs. target:</span>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-emerald-100 dark:bg-emerald-900/40" />
                  <span>At target</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-amber-50 dark:bg-amber-900/20" />
                  <span>Near target</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded bg-red-50 dark:bg-red-900/20" />
                  <span>Below target</span>
                </div>
              </div>
            </>
          }
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}
