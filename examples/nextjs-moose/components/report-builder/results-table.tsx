"use client";

import { cn } from "@/lib/utils";
import { TableIcon } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ResultsTableConfig } from "./types";

/**
 * Default value formatter for table cells.
 */
function defaultFormatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    // Format percentages (keys containing "ratio" or ending in "Ratio")
    if (key.toLowerCase().includes("ratio")) {
      return `${(value * 100).toFixed(1)}%`;
    }
    // Format currency (keys containing "amount" or "Amount")
    if (key.toLowerCase().includes("amount")) {
      return `$${value.toLocaleString()}`;
    }
    return value.toLocaleString();
  }
  return String(value);
}

export type ResultsTableProps<
  TDimension extends string = string,
  TMetric extends string = string,
  TResult extends Record<string, unknown> = Record<string, unknown>,
> = ResultsTableConfig<TDimension, TMetric, TResult>;

export function ResultsTable<
  TDimension extends string,
  TMetric extends string,
  TResult extends Record<string, unknown>,
>({
  data,
  dimensions,
  metrics,
  dimensionLabels,
  metricLabels,
  dataKeyMap = {},
  formatValue = defaultFormatValue,
}: ResultsTableProps<TDimension, TMetric, TResult>) {
  // Helper to get actual data key for a column
  const getDataKey = (col: string) => dataKeyMap[col] ?? col;
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <TableIcon className="size-12 mb-4 opacity-40" />
        <p className="text-lg font-medium">No results</p>
        <p className="text-sm">Try adjusting your filters or selections</p>
      </div>
    );
  }

  const columns = [...dimensions, ...metrics];

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            {columns.map((col) => (
              <TableHead
                key={col}
                className={cn(
                  "px-4 py-3 font-semibold",
                  dimensions.includes(col as TDimension) ? "text-chart-3" : (
                    "text-chart-1"
                  ),
                  metrics.includes(col as TMetric) && "text-right",
                )}
              >
                {dimensionLabels[col as TDimension] ||
                  metricLabels[col as TMetric] ||
                  col}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, i) => (
            <TableRow key={i} className="hover:bg-muted/30">
              {columns.map((col) => (
                <TableCell
                  key={col}
                  className={cn(
                    "px-4 py-3",
                    metrics.includes(col as TMetric) ?
                      "font-mono tabular-nums text-right"
                    : "font-medium",
                  )}
                >
                  {formatValue(col, row[getDataKey(col)])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
