/**
 * Example BYOF (Bring Your Own Framework) Raw Node.js handler
 *
 * This file demonstrates how to use a raw Node.js HTTP handler with MooseStack
 * for consumption APIs using the WebApp class.
 */

import { WebApp, getMooseUtils } from "@514labs/moose-lib";
import { BarAggregatedMV } from "../views/barAggregated";
import { IncomingMessage, ServerResponse } from "http";
import { parse as parseUrl } from "url";

/**
 * Simple router for raw handler
 */
const router = async (req: IncomingMessage, res: ServerResponse) => {
  const url = parseUrl(req.url || "", true);
  const pathname = url.pathname || "/";

  console.log(`[barRaw.ts] ${req.method} ${pathname}`);

  // Health check endpoint
  if (pathname === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        status: "ok",
        timestamp: new Date().toISOString(),
        service: "bar-raw-api",
      }),
    );
    return;
  }

  // Query endpoint
  if (pathname === "/query" && req.method === "GET") {
    const moose = getMooseUtils(req);
    if (!moose) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "MooseStack utilities not available" }));
      return;
    }

    const { client, sql } = moose;
    const limit = parseInt((url.query.limit as string) || "10");

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

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          count: data.length,
          data,
        }),
      );
    } catch (error) {
      console.error("Query error:", error);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return;
  }

  // Data endpoint with POST
  if (pathname === "/data" && req.method === "POST") {
    const moose = getMooseUtils(req);
    if (!moose) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "MooseStack utilities not available" }));
      return;
    }

    // Parse POST body
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const { client, sql } = moose;
        const {
          orderBy = "totalRows",
          limit = 5,
          startDay = 1,
          endDay = 31,
        } = JSON.parse(body || "{}");

        const query = sql`
          SELECT
            ${BarAggregatedMV.targetTable.columns.dayOfMonth},
            ${BarAggregatedMV.targetTable.columns[orderBy]}
          FROM ${BarAggregatedMV.targetTable}
          WHERE
            dayOfMonth >= ${startDay}
            AND dayOfMonth <= ${endDay}
          ORDER BY ${BarAggregatedMV.targetTable.columns[orderBy]} DESC
          LIMIT ${limit}
        `;

        const result = await client.query.execute(query);
        const data = await result.json();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            params: { orderBy, limit, startDay, endDay },
            count: data.length,
            data,
          }),
        );
      } catch (error) {
        console.error("Query error:", error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    });
    return;
  }

  // 404 for unknown routes
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
};

export const barRawApi = new WebApp("barRaw", router, {
  mountPath: "/raw",
  metadata: {
    description: "Raw Node.js handler demonstrating WebApp integration",
  },
});
