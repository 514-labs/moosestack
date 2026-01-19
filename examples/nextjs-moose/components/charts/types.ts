/**
 * Chart type definitions and interfaces.
 */

export type ChartType = "timeSeries" | "donut" | "bar" | "area";

export type ExportFormat = "png" | "svg" | "csv" | "json" | "pdf";

export interface ChartDisplayOptions {
  showLabels?: boolean;
  showLegend?: boolean;
  showGrid?: boolean;
  showTooltip?: boolean;
  [key: string]: boolean | undefined;
}

export interface ExportData {
  csv?: string;
  json?: unknown;
}

export interface ShareableState {
  chartId: string;
  chartType: ChartType;
  data: unknown;
  options: ChartDisplayOptions;
}

export interface GridSpan {
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
}

export interface ChartTypeConfig {
  type: ChartType;
  displayOptions: ChartDisplayOptions;
  exportFormats: ExportFormat[];
  serializeData: (data: unknown) => ExportData;
  getShareableState: (
    chartId: string,
    data: unknown,
    options: ChartDisplayOptions,
  ) => ShareableState;
}

/** Generic data point for charts */
export interface DataPoint {
  [key: string]: string | number | boolean | null | undefined;
}

/** Time series data point */
export interface TimeSeriesDataPoint {
  time: string;
  count: number;
}

/** Pie/donut chart data point */
export interface PieDataPoint {
  name: string;
  value: number;
}

/** Default option labels for display options */
export const DEFAULT_OPTION_LABELS: Record<string, string> = {
  showLabels: "Show labels",
  showLegend: "Show legend",
  showGrid: "Show grid",
  showTooltip: "Show tooltip",
} as const;
