export const ACCESS_ROLE_TENANT = "tenant";
export const ACCESS_ROLE_ADMIN_DEBUG = "admin_debug";
export const ORG_ID_CLAIM = "org_id";
export const ACCESS_ROLE_CLAIM = "access_role";

export type AccessRole =
  | typeof ACCESS_ROLE_TENANT
  | typeof ACCESS_ROLE_ADMIN_DEBUG;

// EXAMPLE_APP_ONLY: These dashboard DTOs are coupled to the seeded
// TenantKnowledge demo dashboard. Replace or remove them when you swap out the
// example data model, then search the repo for EXAMPLE_APP_ONLY to find the
// downstream demo wiring.
export interface KnowledgeMetrics {
  totalRecords: number;
  highPriorityRecords: number;
}

export interface RecentKnowledgeRecord {
  orgId: string;
  headline: string;
  category: string;
  priority: string;
  source: string;
  timestamp: string;
}

export interface DashboardSnapshot {
  knowledgeMetrics: KnowledgeMetrics;
  recentKnowledge: RecentKnowledgeRecord[];
}

export const DASHBOARD_SNAPSHOT_PATH = "/app/dashboard/snapshot";
