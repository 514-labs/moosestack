import type { MooseUtils } from "@514labs/moose-lib";
import type { DashboardSnapshot } from "agent-contracts";
import { executeScopedSql } from "../../data/clickhouse/readonly-query";
import {
  dashboardKnowledgeMetricsModel,
  dashboardRecentKnowledgeModel,
} from "./dashboard";

/**
 * EXAMPLE_APP_ONLY:
 * This dashboard snapshot composition is coupled to the seeded TenantKnowledge
 * demo dashboard. Replace or remove it when you swap out the example data
 * model, then search the repo for EXAMPLE_APP_ONLY to find the downstream demo
 * wiring.
 */
export async function getDashboardSnapshot(
  queryClient: MooseUtils["client"]["query"],
): Promise<DashboardSnapshot> {
  const [knowledgeMetrics, recentKnowledge] = await Promise.all([
    executeScopedSql<{
      totalRecords: number;
      highPriorityRecords: number;
    }>(
      queryClient,
      dashboardKnowledgeMetricsModel.toSql({
        metrics: ["totalRecords", "highPriorityRecords"],
        limit: 1,
      }),
    ),
    executeScopedSql<{
      orgId: string;
      headline: string;
      category: string;
      priority: string;
      source: string;
      timestamp: string;
    }>(
      queryClient,
      dashboardRecentKnowledgeModel.toSql({
        columns: [
          "orgId",
          "headline",
          "category",
          "priority",
          "source",
          "timestamp",
        ],
        orderBy: [["timestamp", "DESC"]],
        limit: 5,
      }),
    ),
  ]);

  return {
    knowledgeMetrics: knowledgeMetrics[0] ?? {
      totalRecords: 0,
      highPriorityRecords: 0,
    },
    recentKnowledge,
  };
}
