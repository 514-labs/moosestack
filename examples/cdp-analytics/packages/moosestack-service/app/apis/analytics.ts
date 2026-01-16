/**
 * Analytics API - Express routes for CDP dashboard
 *
 * This file handles HTTP routing only. Business logic is in services/analyticsService.ts
 */

import express from "express";
import { WebApp } from "@514labs/moose-lib";
import {
  getFunnelData,
  getMetrics,
  getPerformanceData,
  getCampaignSegments,
  getDeviceSegments,
  getConversionTrend,
  getCohortData,
} from "../services/analyticsService";

// Re-export types for frontend consumers
export type {
  FunnelStage,
  Metrics,
  PerformanceData,
  SegmentData,
  ConversionTrendPoint,
  StageData,
  CohortData,
} from "../types/analytics";

// ============================================================================
// Express App Setup
// ============================================================================

const app = express();
app.use(express.json());

// CORS middleware
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization",
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// ============================================================================
// Routes
// ============================================================================

/** GET /funnel - Email acquisition funnel data */
app.get("/funnel", async (req, res) => {
  try {
    const data = await getFunnelData();
    res.json(data);
  } catch (error) {
    console.error("Error fetching funnel data:", error);
    res.status(500).json({ error: "Failed to fetch funnel data" });
  }
});

/** GET /metrics - KPI metrics for dashboard header */
app.get("/metrics", async (req, res) => {
  try {
    const data = await getMetrics();
    res.json(data);
  } catch (error) {
    console.error("Error fetching metrics:", error);
    res.status(500).json({ error: "Failed to fetch metrics" });
  }
});

/** GET /performance - Campaign performance over time */
app.get("/performance", async (req, res) => {
  try {
    const data = await getPerformanceData();
    res.json(data);
  } catch (error) {
    console.error("Error fetching performance data:", error);
    res.status(500).json({ error: "Failed to fetch performance data" });
  }
});

/** GET /segments/campaigns - Signups by acquisition channel */
app.get("/segments/campaigns", async (req, res) => {
  try {
    const data = await getCampaignSegments();
    res.json(data);
  } catch (error) {
    console.error("Error fetching campaign segments:", error);
    res.status(500).json({ error: "Failed to fetch campaign segments" });
  }
});

/** GET /segments/devices - Clicks by device type */
app.get("/segments/devices", async (req, res) => {
  try {
    const data = await getDeviceSegments();
    res.json(data);
  } catch (error) {
    console.error("Error fetching device segments:", error);
    res.status(500).json({ error: "Failed to fetch device segments" });
  }
});

/** GET /conversion-trend - Weekly conversion rate for sparkline */
app.get("/conversion-trend", async (req, res) => {
  try {
    const data = await getConversionTrend();
    res.json(data);
  } catch (error) {
    console.error("Error fetching conversion trend:", error);
    res.status(500).json({ error: "Failed to fetch conversion trend" });
  }
});

/** GET /cohorts - Cohort journey progression data */
app.get("/cohorts", async (req, res) => {
  try {
    const data = await getCohortData();
    res.json(data);
  } catch (error) {
    console.error("Error fetching cohort data:", error);
    res.status(500).json({ error: "Failed to fetch cohort data" });
  }
});

// ============================================================================
// WebApp Export
// ============================================================================

export const analyticsApi = new WebApp("analyticsApi", app, {
  mountPath: "/analytics",
  metadata: {
    description: "Analytics API for CDP dashboard",
  },
});
