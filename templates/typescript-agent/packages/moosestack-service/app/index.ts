export * from "./http/dashboard/api";

/**
 * EXAMPLE_APP_ONLY:
 * These exports wire the seeded TenantKnowledge demo model, dashboard, and MCP
 * surface into Moose discovery. Replace or remove them when you swap out the
 * example data model, then search the repo for EXAMPLE_APP_ONLY to find the
 * downstream demo wiring.
 */
export * from "./ingest/models";
export * from "./mcp/server";
export * from "./semantic/dashboard-snapshot";
export * from "./semantic/knowledge";
