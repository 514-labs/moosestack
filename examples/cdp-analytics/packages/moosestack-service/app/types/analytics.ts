/**
 * Analytics API Response Types
 * Shared between backend services and frontend consumers
 */

/** GET /analytics/funnel */
export interface FunnelStage {
  stage: string;
  count: number;
  rate: string;
}

/** GET /analytics/metrics */
export interface Metrics {
  emailsSent: number;
  openRate: number;
  clickRate: number;
  signups: number;
  conversionRate: number;
}

/** GET /analytics/performance */
export interface PerformanceData {
  date: string;
  opened: number;
  clicked: number;
  signups: number;
}

/** GET /analytics/segments/campaigns and /segments/devices */
export interface SegmentData {
  name: string;
  value: number;
  color: string;
}

/** GET /analytics/conversion-trend */
export interface ConversionTrendPoint {
  week: string;
  rate: number;
}

/** Stage data within a cohort */
export interface StageData {
  count: number;
  rate: number;
}

/** GET /analytics/cohorts */
export interface CohortData {
  cohort: string;
  cohortWeek?: string;
  size: number;
  stages: {
    entered: StageData;
    engaged: StageData;
    active: StageData;
    converted: StageData;
  };
  revenue: number;
}
