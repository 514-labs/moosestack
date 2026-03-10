"use server";

const BACKEND = process.env.MCP_SERVER_URL || "http://localhost:4000";

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
  return `${BACKEND}/reviews/metrics?${params}`;
}

export async function executeQuery(
  params: QueryRequest,
): Promise<Record<string, unknown>[]> {
  const url = buildUrl(
    params.metrics,
    params.dimensions,
    params.limit ?? 100,
    params.filters,
  );
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Backend error: ${res.status}`);
  const json = await res.json();
  return json.data ?? [];
}

export async function fetchSchema(): Promise<{
  name: string;
  description: string;
  metrics: { id: string; label: string; description?: string }[];
  dimensions: { id: string; label: string; description?: string }[];
  filters: {
    id: string;
    label: string;
    operators: string[];
    description?: string;
    values?: { value: string; label: string }[];
  }[];
  sortable: string[];
  defaults: {
    metrics?: string[];
    dimensions?: string[];
    limit?: number;
    maxLimit?: number;
  };
}> {
  const res = await fetch(`${BACKEND}/reviews/schema`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Backend error: ${res.status}`);
  return res.json();
}
