"use client";

/**
 * Stats Cards
 *
 * Reusable component for displaying key metrics in a grid.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

export interface StatItem {
  title: string;
  value: number | string;
  description?: string;
  icon?: LucideIcon;
  change?: string;
  isPositive?: boolean;
}

export interface StatsCardsProps {
  stats: StatItem[];
  isLoading?: boolean;
  columns?: { sm?: number; md?: number; lg?: number };
  className?: string;
}

export function StatsCards({
  stats,
  isLoading = false,
  columns = { sm: 2, lg: 4 },
  className,
}: StatsCardsProps) {
  if (isLoading) {
    return (
      <div
        className={
          className ??
          `grid grid-cols-${columns.sm ?? 2} lg:grid-cols-${columns.lg ?? 4} gap-4`
        }
      >
        {Array.from({ length: columns.lg ?? 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Loading...</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">-</div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div
      className={
        className ??
        "grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 lg:gap-6 p-3 sm:p-4 lg:p-6 rounded-xl border bg-card"
      }
    >
      {stats.map((stat, index) => (
        <div key={stat.title} className="flex items-start">
          <div className="flex-1 space-y-2 sm:space-y-4 lg:space-y-6">
            <div className="flex items-center gap-1 sm:gap-1.5 text-muted-foreground">
              {stat.icon && <stat.icon className="size-3.5 sm:size-[18px]" />}
              <span className="text-[10px] sm:text-xs lg:text-sm font-medium truncate">
                {stat.title}
              </span>
            </div>
            <p className="text-lg sm:text-xl lg:text-[28px] font-semibold leading-tight tracking-tight">
              {typeof stat.value === "number" ?
                formatNumber(stat.value)
              : stat.value}
            </p>
            {(stat.change || stat.description) && (
              <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-[10px] sm:text-xs lg:text-sm font-medium">
                {stat.change && (
                  <span
                    className={
                      stat.isPositive ? "text-emerald-600" : "text-red-600"
                    }
                  >
                    <span className="hidden sm:inline">{stat.change}</span>
                  </span>
                )}
                {stat.description && (
                  <span className="text-muted-foreground hidden sm:inline">
                    {stat.description}
                  </span>
                )}
              </div>
            )}
          </div>
          {index < stats.length - 1 && (
            <div className="hidden lg:block w-px h-full bg-border mx-4 xl:mx-6" />
          )}
        </div>
      ))}
    </div>
  );
}
