import { tenantIsolation } from "../../ingest/models";
import {
  createToolAccessPolicy,
  type DataCatalogResponse,
  type RuntimeTable,
} from "./policy";

const EXPOSED_TABLES = tenantIsolation.config.tables as readonly RuntimeTable[];

const toolAccessPolicy = createToolAccessPolicy(EXPOSED_TABLES);

export type { DataCatalogResponse };

export const {
  getExposedDataCatalog,
  formatExposedCatalogSummary,
  formatExposedCatalogDetailed,
  validateExposedReadonlyQuery,
} = toolAccessPolicy;
