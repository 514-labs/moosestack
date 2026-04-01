import { tenantIsolation } from "../../ingest/models";
import { createToolAccessPolicy, type DataCatalogResponse, type RuntimeTable } from "./policy";

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
const EXPOSED_TABLES = configuredTables.filter(isRuntimeTable);

if (EXPOSED_TABLES.length !== configuredTables.length) {
  throw new Error("All exposed tables must define columnArray and generateTableName().");
}

const toolAccessPolicy = createToolAccessPolicy(EXPOSED_TABLES);

export type { DataCatalogResponse };

export const {
  getExposedDataCatalog,
  formatExposedCatalogSummary,
  formatExposedCatalogDetailed,
  validateExposedReadonlyQuery,
} = toolAccessPolicy;
