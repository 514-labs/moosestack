/**
 * Chart type configurations with display options and data serialization.
 */

import type {
  ChartTypeConfig,
  ChartDisplayOptions,
  ExportData,
  ShareableState,
} from "./chart-types";
import type { TimeSeriesData } from "@/app/actions/events";

interface PieData {
  status: string;
  count: number;
}

/**
 * Convert time series data to CSV format.
 */
function timeSeriesToCSV(data: TimeSeriesData): string {
  const headers = ["time", "count"];
  const rows = data.map((row) => [row.time, row.count.toString()]);
  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

/**
 * Convert pie/donut data to CSV format.
 */
function pieDataToCSV(data: PieData[]): string {
  const headers = ["status", "count"];
  const rows = data.map((row) => [row.status, row.count.toString()]);
  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

/**
 * Chart type configurations for each supported chart type.
 */
export const chartTypeConfigs: Record<string, ChartTypeConfig> = {
  timeSeries: {
    type: "timeSeries",
    displayOptions: {
      showGrid: true,
      showTooltip: true,
    },
    exportFormats: ["png", "svg", "csv", "json"],
    serializeData: (data: unknown): ExportData => {
      const timeSeriesData = data as TimeSeriesData;
      return {
        csv: timeSeriesToCSV(timeSeriesData),
        json: timeSeriesData,
      };
    },
    getShareableState: (
      chartId: string,
      data: unknown,
      options: ChartDisplayOptions,
    ): ShareableState => ({
      chartId,
      chartType: "timeSeries",
      data,
      options,
    }),
  },
  donut: {
    type: "donut",
    displayOptions: {
      showLabels: true,
    },
    exportFormats: ["png", "svg", "csv", "json"],
    serializeData: (data: unknown): ExportData => {
      const pieData = data as PieData[];
      return {
        csv: pieDataToCSV(pieData),
        json: pieData,
      };
    },
    getShareableState: (
      chartId: string,
      data: unknown,
      options: ChartDisplayOptions,
    ): ShareableState => ({
      chartId,
      chartType: "donut",
      data,
      options,
    }),
  },
} as const;
