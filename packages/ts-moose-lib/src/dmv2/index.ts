/**
 * @module dmv2
 * This module defines the core Moose v2 data model constructs, including OlapTable, Stream, IngestApi, Api,
 * IngestPipeline, View, and MaterializedView. These classes provide a typed interface for defining and managing
 * data infrastructure components like ClickHouse tables, Redpanda streams, and data processing pipelines.
 */

/**
 * A helper type used potentially for indicating aggregated fields in query results or schemas.
 * Captures the aggregation function name and argument types.
 * (Usage context might be specific to query builders or ORM features).
 *
 * @template AggregationFunction The name of the aggregation function (e.g., 'sum', 'avg', 'count').
 * @template ArgTypes An array type representing the types of the arguments passed to the aggregation function.
 */
export type Aggregated<
  AggregationFunction extends string,
  ArgTypes extends any[] = [],
> = {
  _aggregationFunction?: AggregationFunction;
  _argTypes?: ArgTypes;
};

export { OlapTable, OlapConfig, S3QueueTableSettings } from "./sdk/olapTable";
export {
  Stream,
  StreamConfig,
  DeadLetterModel,
  DeadLetter,
  DeadLetterQueue,
  ConsumerConfig,
  TransformConfig,
} from "./sdk/stream";

export { Workflow, Task } from "./sdk/workflow";
export type { TaskContext, TaskConfig } from "./sdk/workflow";

export { IngestApi, IngestConfig } from "./sdk/ingestApi";
export {
  Api,
  ApiConfig,
  EgressConfig,
  ConsumptionApi,
} from "./sdk/consumptionApi";
export { IngestPipeline, IngestPipelineConfig } from "./sdk/ingestPipeline";
export { ETLPipeline, ETLPipelineConfig } from "./sdk/etlPipeline";
export {
  MaterializedView,
  MaterializedViewConfig,
} from "./sdk/materializedView";
export { SqlResource } from "./sdk/sqlResource";
export { View } from "./sdk/view";
export { LifeCycle } from "./sdk/lifeCycle";
