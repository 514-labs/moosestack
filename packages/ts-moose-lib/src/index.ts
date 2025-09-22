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
export * from "./consumption-apis/helpers";
export * from "./scripts/task";

export { createApi, createConsumptionApi } from "./consumption-apis/runner";

export { MooseCache } from "./clients/redisClient";

export { ApiUtil, ConsumptionUtil } from "./consumption-apis/helpers";

export * from "./utilities";
export * from "./connectors/dataSource";
