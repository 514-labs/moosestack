import {
  DASHBOARD_SNAPSHOT_PATH,
  type DashboardSnapshot,
} from "agent-contracts";
import { z } from "zod";
import { getMooseServiceUrl } from "@/env-vars";

// EXAMPLE_APP_ONLY: This dashboard snapshot schema is coupled to the seeded
// TenantKnowledge demo dashboard. Replace or remove it when you swap out the
// example data model, then search the repo for EXAMPLE_APP_ONLY to find the
// downstream demo wiring.
const DashboardSnapshotSchema = z.object({
  knowledgeMetrics: z.object({
    totalRecords: z.number(),
    highPriorityRecords: z.number(),
  }),
  recentKnowledge: z.array(
    z.object({
      orgId: z.string(),
      headline: z.string(),
      category: z.string(),
      priority: z.string(),
      source: z.string(),
      timestamp: z.string(),
    }),
  ),
}) satisfies z.ZodType<DashboardSnapshot>;

export class DashboardSnapshotUnauthorizedError extends Error {
  constructor() {
    super("Dashboard snapshot request was unauthorized");
    this.name = "DashboardSnapshotUnauthorizedError";
  }
}

export async function getDashboardSnapshot(
  bearerToken: string,
): Promise<DashboardSnapshot> {
  const response = await fetch(
    `${getMooseServiceUrl()}${DASHBOARD_SNAPSHOT_PATH}`,
    {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${bearerToken}`,
      },
    },
  );

  if (response.status === 401) {
    throw new DashboardSnapshotUnauthorizedError();
  }

  if (!response.ok) {
    throw new Error(
      `Failed to load dashboard snapshot: ${response.status} ${response.statusText}`,
    );
  }

  return DashboardSnapshotSchema.parse(await response.json());
}
