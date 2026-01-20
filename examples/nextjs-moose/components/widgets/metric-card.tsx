"use client";

/**
 * Metric Card
 *
 * Generic reusable component for displaying a single metric.
 */

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

// =============================================================================
// Types
// =============================================================================

export interface MetricCardProps {
  title: string;
  value: number | string;
  description?: string;
  icon?: LucideIcon;
  change?: string;
  isPositive?: boolean;
  showDivider?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-US").format(num);
}

// =============================================================================
// Metric Card
// =============================================================================

export function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  change,
  isPositive,
  showDivider = false,
}: MetricCardProps) {
  return (
    <div className="flex items-start">
      <div className="flex-1 space-y-2 sm:space-y-4 lg:space-y-6">
        <div className="flex items-center gap-1 sm:gap-1.5 text-muted-foreground">
          {Icon && <Icon className="size-3.5 sm:size-[18px]" />}
          <span className="text-[10px] sm:text-xs lg:text-sm font-medium truncate">
            {title}
          </span>
        </div>
        <p className="text-lg sm:text-xl lg:text-[28px] font-semibold leading-tight tracking-tight">
          {typeof value === "number" ? formatNumber(value) : value}
        </p>
        {(change || description) && (
          <div className="flex flex-wrap items-center gap-1 sm:gap-2 text-[10px] sm:text-xs lg:text-sm font-medium">
            {change && (
              <span
                className={isPositive ? "text-emerald-600" : "text-red-600"}
              >
                <span className="hidden sm:inline">{change}</span>
              </span>
            )}
            {description && (
              <span className="text-muted-foreground hidden sm:inline">
                {description}
              </span>
            )}
          </div>
        )}
      </div>
      {showDivider && (
        <div className="hidden lg:block w-px h-full bg-border mx-4 xl:mx-6" />
      )}
    </div>
  );
}

// =============================================================================
// Metric Card Skeleton
// =============================================================================

export function MetricCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">Loading...</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">-</div>
      </CardContent>
    </Card>
  );
}

// =============================================================================
// Metric Cards Container
// =============================================================================

export interface MetricCardsContainerProps {
  children: React.ReactNode;
  isLoading?: boolean;
  skeletonCount?: number;
  className?: string;
}

export function MetricCardsContainer({
  children,
  isLoading = false,
  skeletonCount = 4,
  className,
}: MetricCardsContainerProps) {
  if (isLoading) {
    return (
      <div className={className ?? "grid grid-cols-2 lg:grid-cols-4 gap-4"}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <MetricCardSkeleton key={i} />
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
      {children}
    </div>
  );
}
