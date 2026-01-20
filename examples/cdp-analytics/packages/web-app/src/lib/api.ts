// Re-export types from backend for use across the frontend
export type {
  // Data models
  Customer,
  Event,
  Session,
  Transaction,
  TransactionItem,
  Product,
  // API response types
  FunnelStage,
  Metrics,
  PerformanceData,
  SegmentData,
  ConversionTrendPoint,
  CohortData,
  StageData,
} from "moosestack-service";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export const analyticsApi = {
  funnel: `${API_BASE}/analytics/funnel`,
  metrics: `${API_BASE}/analytics/metrics`,
  performance: `${API_BASE}/analytics/performance`,
  cohorts: `${API_BASE}/analytics/cohorts`,
  conversionTrend: `${API_BASE}/analytics/conversion-trend`,
  campaignSegments: `${API_BASE}/analytics/segments/campaigns`,
  deviceSegments: `${API_BASE}/analytics/segments/devices`,
};

export async function fetchApi<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }
  return response.json();
}
