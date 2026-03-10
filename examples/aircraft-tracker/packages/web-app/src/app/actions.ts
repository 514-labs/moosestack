"use server";

/**
 * Server actions for querying the aircraft metrics API.
 * These proxy to the MooseStack backend so client components
 * don't need to know the backend URL.
 */

const BACKEND = process.env.MCP_SERVER_URL || "http://localhost:4000";

export interface MetricsResult {
  totalAircraft: number;
  planesInAir: number;
  planesOnGround: number;
  avgGroundSpeed: number;
  maxAltitude: number;
  avgAltitude: number;
  emergencyCount: number;
  autopilotEngaged: number;
  totalDatapoints: number;
}

export interface TimeSeriesPoint {
  time: string;
  aircraft: number;
  datapoints: number;
}

export interface CategoryBreakdown {
  name: string;
  value: number;
}

export interface QueryRequest {
  dimensions: string[];
  metrics: string[];
  filters?: Record<string, Record<string, unknown>>;
  limit?: number;
}

function buildUrl(
  metrics: string[],
  dimensions: string[] = [],
  limit?: number,
  filters?: Record<string, Record<string, unknown>>,
): string {
  const params = new URLSearchParams();
  params.set("metrics", metrics.join(","));
  if (dimensions.length > 0) {
    params.set("dimensions", dimensions.join(","));
  }
  if (limit) {
    params.set("limit", limit.toString());
  }
  if (filters) {
    for (const [name, ops] of Object.entries(filters)) {
      for (const [op, value] of Object.entries(ops)) {
        if (value === undefined || value === null || value === "") continue;
        const strValue = Array.isArray(value) ? value.join(",") : String(value);
        params.set(`filter.${name}.${op}`, strValue);
      }
    }
  }
  return `${BACKEND}/aircraft/metrics?${params}`;
}

async function fetchMetrics(url: string): Promise<Record<string, unknown>[]> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Backend error: ${res.status}`);
  const json = await res.json();
  return json.data ?? [];
}

/**
 * Get summary metrics (single row, no dimensions).
 */
export async function getMetrics(): Promise<MetricsResult> {
  const data = await fetchMetrics(
    buildUrl([
      "totalAircraft",
      "planesInAir",
      "planesOnGround",
      "avgGroundSpeed",
      "maxAltitude",
      "avgAltitude",
      "emergencyCount",
      "autopilotEngaged",
      "totalDatapoints",
    ]),
  );
  const row = data[0] ?? {};
  return {
    totalAircraft: Number(row.totalAircraft) || 0,
    planesInAir: Number(row.planesInAir) || 0,
    planesOnGround: Number(row.planesOnGround) || 0,
    avgGroundSpeed: Number(row.avgGroundSpeed) || 0,
    maxAltitude: Number(row.maxAltitude) || 0,
    avgAltitude: Number(row.avgAltitude) || 0,
    emergencyCount: Number(row.emergencyCount) || 0,
    autopilotEngaged: Number(row.autopilotEngaged) || 0,
    totalDatapoints: Number(row.totalDatapoints) || 0,
  };
}

/**
 * Get aircraft count and datapoints over time, grouped by minute.
 */
export async function getAircraftOverTime(): Promise<TimeSeriesPoint[]> {
  const data = await fetchMetrics(
    buildUrl(["totalAircraft", "totalDatapoints"], ["minute"], 1440),
  );
  return data
    .map((row) => ({
      time: String(row.minute),
      aircraft: Number(row.totalAircraft) || 0,
      datapoints: Number(row.totalDatapoints) || 0,
    }))
    .sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * Get aircraft count grouped by emitter category.
 */
export async function getAircraftByCategory(): Promise<CategoryBreakdown[]> {
  const data = await fetchMetrics(
    buildUrl(["totalAircraft"], ["category"], 50),
  );

  const categoryLabels: Record<string, string> = {
    "": "Unknown",
    A0: "Unspecified",
    A1: "Light",
    A2: "Small",
    A3: "Large",
    A4: "High-vortex",
    A5: "Heavy",
    A6: "High-perf",
    A7: "Rotorcraft",
  };

  return data
    .map((row) => {
      const code = String(row.category);
      return {
        name: categoryLabels[code] ?? code,
        value: Number(row.totalAircraft) || 0,
      };
    })
    .sort((a, b) => b.value - a.value);
}

export interface DatasetMetadata {
  totalDatapoints: number;
  firstSeen: string;
  lastSeen: string;
  distinctCategories: number;
  distinctAircraftTypes: number;
}

/**
 * Get dataset metadata — info about the data itself, not the aircraft.
 */
export async function getDatasetMetadata(): Promise<DatasetMetadata> {
  const data = await fetchMetrics(
    buildUrl([
      "totalDatapoints",
      "firstSeen",
      "lastSeen",
      "distinctCategories",
      "distinctAircraftTypes",
    ]),
  );
  const row = data[0] ?? {};
  return {
    totalDatapoints: Number(row.totalDatapoints) || 0,
    firstSeen: String(row.firstSeen ?? ""),
    lastSeen: String(row.lastSeen ?? ""),
    distinctCategories: Number(row.distinctCategories) || 0,
    distinctAircraftTypes: Number(row.distinctAircraftTypes) || 0,
  };
}

/**
 * Execute a dynamic query against the aircraft metrics API.
 * Used by the report builder for user-configurable queries.
 */
export async function executeQuery(
  params: QueryRequest,
): Promise<Record<string, unknown>[]> {
  const url = buildUrl(
    params.metrics,
    params.dimensions,
    params.limit ?? 100,
    params.filters,
  );
  return fetchMetrics(url);
}
