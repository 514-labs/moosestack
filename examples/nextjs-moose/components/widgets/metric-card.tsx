"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

// MetricCard

export interface MetricCardProps {
  title: string;
  value: number | string;
  description?: string;
  icon?: LucideIcon;
}

export function MetricCard({
  title,
  value,
  description,
  icon: Icon,
}: MetricCardProps) {
  const formatted =
    typeof value === "number" ?
      new Intl.NumberFormat("en-US").format(value)
    : value;

  return (
    <div className="space-y-2 lg:space-y-4">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        {Icon && <Icon className="size-4" />}
        <span className="text-xs lg:text-sm font-medium">{title}</span>
      </div>
      <p className="text-xl lg:text-3xl font-semibold tracking-tight">
        {formatted}
      </p>
      {description && (
        <span className="text-xs lg:text-sm text-muted-foreground">
          {description}
        </span>
      )}
    </div>
  );
}

// MetricRow

export interface MetricRowProps {
  children: React.ReactNode;
  className?: string;
}

export function MetricRow({ children, className }: MetricRowProps) {
  const items = React.Children.toArray(children);

  return (
    <div className={cn("flex p-4 lg:p-6", className)}>
      {items.map((child, i) => (
        <React.Fragment key={i}>
          <div
            className={cn(
              "flex-1 px-4 lg:px-6",
              i === 0 && "pl-0",
              i === items.length - 1 && "pr-0",
            )}
          >
            {child}
          </div>
          {i < items.length - 1 && (
            <div className="my-1 border-r border-border" />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// MetricCardsContainer

export interface MetricCardsContainerProps {
  children: React.ReactNode;
  className?: string;
}

export function MetricCardsContainer({
  children,
  className,
}: MetricCardsContainerProps) {
  const rows = React.Children.toArray(children);

  return (
    <div className={cn("flex flex-col rounded-xl border bg-card", className)}>
      {rows.map((row, i) => (
        <React.Fragment key={i}>
          {row}
          {i < rows.length - 1 && (
            <div className="mx-4 lg:mx-6 border-b border-border" />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
