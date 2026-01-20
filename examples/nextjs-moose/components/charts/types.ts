/**
 * Chart type definitions.
 */

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
