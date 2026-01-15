/**
 * Analytics Service
 * Business logic for analytics endpoints, separated from HTTP routing
 */

import { executeQuery } from "./clickhouseService";
import { cohortMetricsView } from "../views/cohort-metrics";
import { emailFunnelView } from "../views/email-funnel";
import type {
  FunnelStage,
  Metrics,
  PerformanceData,
  SegmentData,
  ConversionTrendPoint,
  CohortData,
} from "../types/analytics";

// ============================================================================
// Helper Functions
// ============================================================================

function formatChannelName(channel: string): string {
  const names: Record<string, string> = {
    organic: "Organic Search",
    paid_search: "Paid Search",
    social: "Social Media",
    referral: "Referral",
    email: "Email Campaign",
  };
  return names[channel] || capitalize(channel);
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// ============================================================================
// Service Functions
// ============================================================================

/**
 * Get email acquisition funnel data from the materialized view.
 * Tracks: Email Acquired → First Visit → Engaged → Converted
 */
export async function getFunnelData(): Promise<FunnelStage[]> {
  const funnelTable = emailFunnelView.targetTable;
  const rows = await executeQuery<{
    emailAcquired: string;
    firstVisit: string;
    engaged: string;
    converted: string;
  }>(`
    SELECT
      sum(emailAcquired) as emailAcquired,
      sum(firstVisit) as firstVisit,
      sum(engaged) as engaged,
      sum(converted) as converted
    FROM ${funnelTable.name}
  `);

  const metrics = rows[0] || {
    emailAcquired: "0",
    firstVisit: "0",
    engaged: "0",
    converted: "0",
  };
  const emailAcquired = parseInt(metrics.emailAcquired, 10);
  const firstVisit = parseInt(metrics.firstVisit, 10);
  const engaged = parseInt(metrics.engaged, 10);
  const converted = parseInt(metrics.converted, 10);

  const calcRate = (count: number, base: number): string =>
    base > 0 ? `${((count / base) * 100).toFixed(1)}%` : "0%";

  return [
    { stage: "Email Acquired", count: emailAcquired, rate: "100%" },
    {
      stage: "First Visit",
      count: firstVisit,
      rate: calcRate(firstVisit, emailAcquired),
    },
    {
      stage: "Engaged",
      count: engaged,
      rate: calcRate(engaged, emailAcquired),
    },
    {
      stage: "Converted",
      count: converted,
      rate: calcRate(converted, emailAcquired),
    },
  ];
}

/**
 * Get KPI metrics for the dashboard header
 */
export async function getMetrics(): Promise<Metrics> {
  const events = await executeQuery<{ count: string }>(`
    SELECT count() as count FROM Event
  `);
  const totalEvents = events[0] ? parseInt(events[0].count, 10) : 0;

  const customers = await executeQuery<{ count: string }>(`
    SELECT count() as count FROM Customer
  `);
  const customerCount = customers[0] ? parseInt(customers[0].count, 10) : 0;

  const clicks = await executeQuery<{ count: string }>(`
    SELECT count() as count FROM Event WHERE eventType = 'click'
  `);
  const clickCount = clicks[0] ? parseInt(clicks[0].count, 10) : 0;

  return {
    emailsSent: totalEvents || 50000,
    openRate: 25, // Simulated
    clickRate:
      totalEvents > 0 ?
        parseFloat(((clickCount / totalEvents) * 100).toFixed(1))
      : 7.5,
    signups: customerCount || 850,
    conversionRate:
      totalEvents > 0 ?
        parseFloat(((customerCount / totalEvents) * 100).toFixed(2))
      : 1.7,
  };
}

/**
 * Get campaign performance over time
 */
export async function getPerformanceData(): Promise<PerformanceData[]> {
  const rows = await executeQuery<{
    week: string;
    total: string;
    clicked: string;
    pageViews: string;
  }>(`
    SELECT
      toStartOfWeek(timestamp) as week,
      count() as total,
      countIf(eventType = 'click') as clicked,
      countIf(eventType = 'page_view') as pageViews
    FROM Event
    GROUP BY week
    ORDER BY week
    LIMIT 10
  `);

  const performanceData = rows.map((row, index) => ({
    date: `Week ${index + 1}`,
    opened: Math.round(parseInt(row.total, 10) * 0.25),
    clicked: parseInt(row.clicked, 10),
    signups: Math.round(parseInt(row.total, 10) * 0.017),
  }));

  if (performanceData.length === 0) {
    return [
      { date: "Week 1", opened: 2000, clicked: 600, signups: 140 },
      { date: "Week 2", opened: 2375, clicked: 710, signups: 165 },
      { date: "Week 3", opened: 2550, clicked: 765, signups: 175 },
      { date: "Week 4", opened: 2750, clicked: 825, signups: 190 },
      { date: "Week 5", opened: 2825, clicked: 850, signups: 180 },
    ];
  }

  return performanceData;
}

/**
 * Get signups by campaign/acquisition channel
 */
export async function getCampaignSegments(): Promise<SegmentData[]> {
  const rows = await executeQuery<{
    acquisitionChannel: string;
    count: string;
  }>(`
    SELECT
      acquisitionChannel,
      count() as count
    FROM Customer
    GROUP BY acquisitionChannel
    ORDER BY count DESC
  `);

  const campaignData = rows.map((row, index) => ({
    name: formatChannelName(row.acquisitionChannel),
    value: parseInt(row.count, 10),
    color: `var(--chart-${(index % 5) + 1})`,
  }));

  if (campaignData.length === 0) {
    return [
      { name: "Welcome Series", value: 320, color: "var(--chart-1)" },
      { name: "Product Launch", value: 245, color: "var(--chart-2)" },
      { name: "Weekly Newsletter", value: 180, color: "var(--chart-3)" },
      { name: "Re-engagement", value: 105, color: "var(--chart-4)" },
    ];
  }

  return campaignData;
}

/**
 * Get clicks by device type
 */
export async function getDeviceSegments(): Promise<SegmentData[]> {
  const rows = await executeQuery<{ deviceType: string; count: string }>(`
    SELECT
      deviceType,
      count() as count
    FROM Session
    GROUP BY deviceType
    ORDER BY count DESC
  `);

  const deviceData = rows.map((row, index) => ({
    name: capitalize(row.deviceType),
    value: parseInt(row.count, 10),
    color: `var(--chart-${(index % 5) + 1})`,
  }));

  if (deviceData.length === 0) {
    return [
      { name: "Mobile", value: 510, color: "var(--chart-1)" },
      { name: "Desktop", value: 280, color: "var(--chart-2)" },
      { name: "Tablet", value: 60, color: "var(--chart-3)" },
    ];
  }

  return deviceData;
}

/**
 * Get weekly conversion rate trend for sparkline
 */
export async function getConversionTrend(): Promise<ConversionTrendPoint[]> {
  const rows = await executeQuery<{
    week: string;
    cohortSize: string;
    conversions: string;
  }>(`
    SELECT
      toStartOfWeek(c.createdAt) as week,
      count(DISTINCT c.customerId) as cohortSize,
      countIf(s.hasConversion = true) as conversions
    FROM Customer c
    LEFT JOIN Session s ON c.customerId = s.customerId
    GROUP BY week
    ORDER BY week DESC
    LIMIT 8
  `);

  const trendData = rows.reverse().map((row, index) => {
    const size = parseInt(row.cohortSize, 10);
    const conversions = parseInt(row.conversions, 10);
    return {
      week: `W${index + 1}`,
      rate: size > 0 ? parseFloat(((conversions / size) * 100).toFixed(1)) : 0,
    };
  });

  if (trendData.length === 0) {
    return [
      { week: "W1", rate: 6.5 },
      { week: "W2", rate: 7.2 },
      { week: "W3", rate: 6.8 },
      { week: "W4", rate: 8.1 },
      { week: "W5", rate: 7.5 },
      { week: "W6", rate: 8.3 },
      { week: "W7", rate: 7.9 },
      { week: "W8", rate: 8.5 },
    ];
  }

  return trendData;
}

/**
 * Get cohort-based journey progression data from the materialized view.
 */
export async function getCohortData(): Promise<CohortData[]> {
  const metricsTable = cohortMetricsView.targetTable;
  const rows = await executeQuery<{
    cohortWeek: string;
    cohortSize: string;
    engagedUsers: string;
    activeUsers: string;
    convertedUsers: string;
    totalRevenue: string;
  }>(`
    SELECT
      cohortWeek,
      sum(cohortSize) as cohortSize,
      sum(engagedUsers) as engagedUsers,
      sum(activeUsers) as activeUsers,
      sum(convertedUsers) as convertedUsers,
      sum(totalRevenue) as totalRevenue
    FROM ${metricsTable.name}
    GROUP BY cohortWeek
    ORDER BY cohortWeek DESC
    LIMIT 8
  `);

  const cohortData = rows.reverse().map((row, index) => {
    const cohortSize = parseInt(row.cohortSize, 10);
    const engagedUsers = parseInt(row.engagedUsers, 10);
    const activeUsers = parseInt(row.activeUsers, 10);
    const convertedUsers = parseInt(row.convertedUsers, 10);
    const revenue = parseFloat(row.totalRevenue) || 0;

    return {
      cohort: `Week ${index + 1}`,
      cohortWeek: row.cohortWeek,
      size: cohortSize,
      stages: {
        entered: { count: cohortSize, rate: 100 },
        engaged: {
          count: engagedUsers,
          rate:
            cohortSize > 0 ? Math.round((engagedUsers / cohortSize) * 100) : 0,
        },
        active: {
          count: activeUsers,
          rate:
            cohortSize > 0 ? Math.round((activeUsers / cohortSize) * 100) : 0,
        },
        converted: {
          count: convertedUsers,
          rate:
            cohortSize > 0 ?
              Math.round((convertedUsers / cohortSize) * 100)
            : 0,
        },
      },
      revenue: Math.round(revenue),
    };
  });

  if (cohortData.length === 0) {
    return [
      {
        cohort: "Week 1",
        size: 1000,
        stages: {
          entered: { count: 1000, rate: 100 },
          engaged: { count: 650, rate: 65 },
          active: { count: 420, rate: 42 },
          converted: { count: 85, rate: 8.5 },
        },
        revenue: 12750,
      },
      {
        cohort: "Week 2",
        size: 1200,
        stages: {
          entered: { count: 1200, rate: 100 },
          engaged: { count: 780, rate: 65 },
          active: { count: 516, rate: 43 },
          converted: { count: 108, rate: 9 },
        },
        revenue: 16200,
      },
      {
        cohort: "Week 3",
        size: 950,
        stages: {
          entered: { count: 950, rate: 100 },
          engaged: { count: 608, rate: 64 },
          active: { count: 380, rate: 40 },
          converted: { count: 76, rate: 8 },
        },
        revenue: 11400,
      },
      {
        cohort: "Week 4",
        size: 1100,
        stages: {
          entered: { count: 1100, rate: 100 },
          engaged: { count: 748, rate: 68 },
          active: { count: 495, rate: 45 },
          converted: { count: 99, rate: 9 },
        },
        revenue: 14850,
      },
    ];
  }

  return cohortData;
}
