import { tenantIsolation } from "../../ingest/models";
import {
  createToolAccessPolicy,
  type DataCatalogResponse,
  type RuntimeTable,
} from "./policy";

function isRuntimeTable(value: unknown): value is RuntimeTable {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const config = Reflect.get(value, "config");
  const generateTableName = Reflect.get(value, "generateTableName");
  const columnArray = Reflect.get(value, "columnArray");

  return (
    typeof config === "object" &&
    config !== null &&
    typeof generateTableName === "function" &&
    Array.isArray(columnArray)
  );
}

const configuredTables = tenantIsolation.config.tables;
// EXAMPLE_APP_ONLY: The exposed table set is derived from the seeded
// TenantKnowledge demo model's row policy. Replace this when you swap out the
// example data model, then search the repo for EXAMPLE_APP_ONLY to find the
// downstream demo wiring.
const EXPOSED_TABLES = configuredTables.filter(isRuntimeTable);

if (EXPOSED_TABLES.length !== configuredTables.length) {
  throw new Error(
    "All exposed tables must define columnArray and generateTableName().",
  );
}

const toolAccessPolicy = createToolAccessPolicy(EXPOSED_TABLES);

export type { DataCatalogResponse };

export const {
  getExposedDataCatalog,
  formatExposedCatalogSummary,
  formatExposedCatalogDetailed,
  validateExposedReadonlyQuery,
} = toolAccessPolicy;
