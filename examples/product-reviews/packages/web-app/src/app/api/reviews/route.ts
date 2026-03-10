import { NextResponse } from "next/server";
import { getMcpServerUrl } from "@/env-vars";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const metrics = searchParams.get("metrics") || "totalReviews,avgRating";
  const dimensions = searchParams.get("dimensions") || "month";
  const limit = searchParams.get("limit") || "100";

  const mcpServerUrl = getMcpServerUrl();
  const mcpApiToken = process.env.MCP_API_TOKEN;

  // Call the MCP tool via JSON-RPC
  const response = await fetch(`${mcpServerUrl}/tools`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(mcpApiToken && { Authorization: `Bearer ${mcpApiToken}` }),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "query_review_metrics",
        arguments: {
          dimensions: dimensions.split(","),
          metrics: metrics.split(","),
          limit: parseInt(limit),
        },
      },
    }),
  });

  const json = await response.json();

  if (json.error) {
    return NextResponse.json({ error: json.error.message }, { status: 500 });
  }

  const text = json.result?.content?.[0]?.text;
  if (!text) {
    return NextResponse.json({ error: "Empty response" }, { status: 500 });
  }

  const data = JSON.parse(text);
  return NextResponse.json(data);
}
