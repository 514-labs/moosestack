export * from "./browserCompatible";

export type DataModelConfig<T> = Partial<{
  ingestion: true;
  storage: {
    enabled?: boolean;
    order_by_fields?: (keyof T)[];
    deduplicate?: boolean;
    name?: string;
  };
  parallelism?: number;
}>;

export * from "./blocks/helpers";
export * from "./commons";
export * from "./secrets";
export * from "./consumption-apis/helpers";
export * from "./consumption-apis/webAppHelpers";
export * from "./scripts/task";

export { createApi, createConsumptionApi } from "./consumption-apis/runner";

export { MooseCache } from "./clients/redisClient";

export { ApiUtil, ConsumptionUtil } from "./consumption-apis/helpers";

export { getMooseClients } from "./consumption-apis/standalone";
export { sql } from "./sqlHelpers";

export * from "./utilities";
export * from "./connectors/dataSource";
export {
  ClickHouseByteSize,
  ClickHouseInt,
  LowCardinality,
  ClickHouseNamedTuple,
  ClickHousePoint,
  ClickHouseRing,
  ClickHouseLineString,
  ClickHouseMultiLineString,
  ClickHousePolygon,
  ClickHouseMultiPolygon,
} from "./dataModels/types";
