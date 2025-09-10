export type Key<T extends string | number | Date> = T;

export type JWT<T extends object> = T;

export {
  Aggregated,
  OlapTable,
  OlapConfig,
  S3QueueTableSettings,
  Stream,
  StreamConfig,
  DeadLetterModel,
  DeadLetter,
  DeadLetterQueue,
  IngestApi,
  IngestConfig,
  Api,
  ApiConfig,
  ConsumptionApi,
  EgressConfig,
  IngestPipeline,
  SqlResource,
  View,
  MaterializedView,
  Task,
  Workflow,
  ETLPipeline,
  ETLPipelineConfig,
  LifeCycle,
} from "./dmv2";

export {
  ClickHousePrecision,
  ClickHouseDecimal,
  ClickHouseByteSize,
  ClickHouseInt,
  LowCardinality,
  ClickHouseNamedTuple,
  ClickHouseDefault,
  WithDefault,
} from "./dataModels/types";

export type { ApiUtil, ConsumptionUtil } from "./consumption-apis/helpers";

export * from "./sqlHelpers";
