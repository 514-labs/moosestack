// Available dimensions and metrics for the report builder
export const DIMENSIONS = [
  { id: "status", label: "Status", description: "Event status" },
  { id: "day", label: "Day", description: "Day (date)" },
  { id: "month", label: "Month", description: "Month start" },
] as const;

export const METRICS = [
  { id: "totalEvents", label: "Total Events", description: "Count of events" },
  { id: "totalAmount", label: "Total Amount", description: "Sum of amounts" },
  { id: "avgAmount", label: "Avg Amount", description: "Average amount" },
  { id: "minAmount", label: "Min Amount", description: "Minimum amount" },
  { id: "maxAmount", label: "Max Amount", description: "Maximum amount" },
  {
    id: "highValueRatio",
    label: "High Value %",
    description: "Ratio of high-value events",
  },
] as const;

export type DimensionId = (typeof DIMENSIONS)[number]["id"];
export type MetricId = (typeof METRICS)[number]["id"];

export interface ReportParams {
  startDate?: string;
  endDate?: string;
  status?: "completed" | "active" | "inactive";
  dimensions?: DimensionId[];
  metrics?: MetricId[];
  groupBy?: DimensionId;
}

export type ReportResult = {
  status?: string;
  timestamp?: string;
  day?: string;
  month?: string;
  totalEvents?: number;
  totalAmount?: number;
  avgAmount?: number;
  minAmount?: number;
  maxAmount?: number;
  highValueRatio?: number;
};
