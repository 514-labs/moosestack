/**
 * Chart type configurations with display options and data serialization.
 */

import type {
  ChartTypeConfig,
  ChartDisplayOptions,
  ExportData,
  ShareableState,
  TimeSeriesDataPoint,
  PieDataPoint,
} from "./types";

/**
 * Convert time series data to CSV format.
 */
function timeSeriesToCSV(data: TimeSeriesDataPoint[]): string {
  const headers = ["time", "count"];
  const rows = data.map((row) => [row.time, row.count.toString()]);
  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

/**
 * Convert pie/donut data to CSV format.
 */
function pieDataToCSV(data: PieDataPoint[]): string {
  const headers = ["name", "value"];
  const rows = data.map((row) => [row.name, row.value.toString()]);
  return [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
}

/**
 * Chart type configurations for each supported chart type.
 */
export const chartConfigs: Record<string, ChartTypeConfig> = {
  timeSeries: {
    type: "timeSeries",
    displayOptions: {
      showGrid: true,
      showTooltip: true,
    },
    exportFormats: ["png", "svg", "csv", "json"],
    serializeData: (data: unknown): ExportData => {
      const timeSeriesData = data as TimeSeriesDataPoint[];
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
      const chartData = data as PieDataPoint[];
      return {
        csv: pieDataToCSV(chartData),
        json: chartData,
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
  bar: {
    type: "bar",
    displayOptions: {
      showGrid: true,
      showTooltip: true,
      showLabels: true,
    },
    exportFormats: ["png", "svg", "csv", "json"],
    serializeData: (data: unknown): ExportData => ({
      json: data,
    }),
    getShareableState: (
      chartId: string,
      data: unknown,
      options: ChartDisplayOptions,
    ): ShareableState => ({
      chartId,
      chartType: "bar",
      data,
      options,
    }),
  },
  area: {
    type: "area",
    displayOptions: {
      showGrid: true,
      showTooltip: true,
    },
    exportFormats: ["png", "svg", "csv", "json"],
    serializeData: (data: unknown): ExportData => ({
      json: data,
    }),
    getShareableState: (
      chartId: string,
      data: unknown,
      options: ChartDisplayOptions,
    ): ShareableState => ({
      chartId,
      chartType: "area",
      data,
      options,
    }),
  },
} as const;
