import {
  DASHBOARD_SNAPSHOT_PATH,
  type DashboardSnapshot,
} from "agent-contracts";
import { getMooseServiceUrl } from "@/env-vars";

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

  if (!response.ok) {
    throw new Error(
      `Failed to load dashboard snapshot: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as DashboardSnapshot;
}
