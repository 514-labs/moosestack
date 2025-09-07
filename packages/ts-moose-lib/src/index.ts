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

// ClickHouse Geo Types (requires ClickHouse 25.6+ with experimental geo types enabled)
export type ClickHousePoint = [number, number];  // [longitude, latitude]
export type ClickHouseRing = ClickHousePoint[];  // Closed polygon boundary (no holes)
export type ClickHouseLineString = ClickHousePoint[];  // Open polyline
export type ClickHousePolygon = ClickHouseRing[];  // First ring is outer, others are holes
export type ClickHouseMultiLineString = ClickHouseLineString[];
export type ClickHouseMultiPolygon = ClickHousePolygon[];

export * from "./blocks/helpers";
export * from "./commons";
export * from "./consumption-apis/helpers";
export * from "./scripts/task";

export { createApi, createConsumptionApi } from "./consumption-apis/runner";

export { MooseCache } from "./clients/redisClient";

export { ApiUtil, ConsumptionUtil } from "./consumption-apis/helpers";

export * from "./utilities";
export * from "./connectors/dataSource";
