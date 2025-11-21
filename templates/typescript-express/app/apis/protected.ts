/**
 * E2E Test for Express API Key Authentication
 *
 * This file demonstrates the expressApiKeyAuthMiddleware for protecting
 * Express routes with API key authentication using PBKDF2 HMAC SHA256.
 *
 * To use this API:
 * 1. Generate an API key: `moose generate hash-token`
 * 2. Set MOOSE_WEB_APP_API_KEYS=<hash from step 1>
 * 3. Make requests with: Authorization: Bearer <token from step 1>
 */

import express from "express";
import {
  WebApp,
  expressMiddleware,
  expressApiKeyAuthMiddleware,
  getMooseUtils,
} from "@514labs/moose-lib";
import { BarAggregatedMV } from "../views/barAggregated";

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Required: Injects MooseStack utilities (client, sql, jwt)
app.use(expressMiddleware());

// Apply API key authentication to all routes in this app
app.use(expressApiKeyAuthMiddleware());

// Health check endpoint (also protected by API key)
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "protected-api-key-api",
  });
});

// Query endpoint with API key protection
app.get("/query", async (req, res) => {
  const moose = getMooseUtils(req);
  if (!moose) {
    return res
      .status(500)
      .json({ error: "MooseStack utilities not available" });
  }

  const { client, sql } = moose;
  const limit = parseInt(req.query.limit as string) || 10;

  try {
    const query = sql`
      SELECT 
        ${BarAggregatedMV.targetTable.columns.dayOfMonth},
        ${BarAggregatedMV.targetTable.columns.totalRows}
      FROM ${BarAggregatedMV.targetTable}
      ORDER BY ${BarAggregatedMV.targetTable.columns.totalRows} DESC
      LIMIT ${limit}
    `;

    const result = await client.query.execute(query);
    const data = await result.json();

    res.json({
      success: true,
      authenticated: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("Query error:", error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Echo endpoint to test authentication
app.post("/echo", (req, res) => {
  res.json({
    authenticated: true,
    message: "API key authentication successful",
    body: req.body,
    timestamp: new Date().toISOString(),
  });
});

// Error handler
app.use((err: any, req: any, res: any, next: any) => {
  console.error("Express error:", err);
  if (!res.headersSent) {
    res.status(500).json({
      error: "Internal Server Error",
      message: err.message,
    });
  }
});

export const protectedApiKeyApi = new WebApp("protectedApiKey", app, {
  mountPath: "/protected-api-key",
  metadata: {
    description:
      "Express API with API key authentication using expressApiKeyAuthMiddleware",
  },
});
