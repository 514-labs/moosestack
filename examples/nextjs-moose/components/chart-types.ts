/**
 * Chart type registry and type definitions for the unified dashboard chart widget system.
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
