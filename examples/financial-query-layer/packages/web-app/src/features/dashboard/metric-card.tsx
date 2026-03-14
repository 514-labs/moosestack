"use client";

import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface MetricCardProps {
  title: string;
  value: string;
  sql: string;
  subtitle?: string;
}

export function MetricCard({ title, value, sql, subtitle }: MetricCardProps) {
  return (
    <div className="rounded-lg border bg-card p-6 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-sm">
            <pre className="text-xs font-mono whitespace-pre-wrap">{sql}</pre>
          </TooltipContent>
        </Tooltip>
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight">{value}</p>
      {subtitle && (
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
