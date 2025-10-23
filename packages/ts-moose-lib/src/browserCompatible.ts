export type Key<T extends string | number | Date> = T;

export type JWT<T extends object> = T;

export {
  Aggregated,
  SimpleAggregated,
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
  WebApp,
  WebAppConfig,
  WebAppHandler,
  FrameworkApp,
} from "./dmv2";

export {
  ClickHousePrecision,
  ClickHouseDecimal,
  ClickHouseByteSize,
  ClickHouseFloat,
  ClickHouseInt,
  ClickHouseJson,
  LowCardinality,
  ClickHouseNamedTuple,
  ClickHouseDefault,
  ClickHouseTTL,
  WithDefault,
  // Added friendly aliases and numeric helpers
  DateTime,
  DateTime64,
  Float32,
  Float64,
  Int8,
  Int16,
  Int32,
  Int64,
  UInt8,
  UInt16,
  UInt32,
  UInt64,
  Decimal,
} from "./dataModels/types";

export type { ApiUtil, ConsumptionUtil } from "./consumption-apis/helpers";

export * from "./sqlHelpers";
