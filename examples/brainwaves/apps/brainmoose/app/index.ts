/**
 * Brainmoose DMV2 Index
 * Entry point for all DMV2 infrastructure components
 *
 * Migration completed from DMV1 to DMV2 following the official Moose documentation:
 * https://docs.fiveonefour.com/moose
 */

// Data Models and Infrastructure Pipelines
export * from "./datamodels/brain";
export * from "./datamodels/models";

// Materialized Views and Aggregations
export * from "./blocks/DailyActiveUsers";

// Consumption APIs
export * from "./apis/getBrainBySessionId";
export * from "./apis/getMostActiveBrainwaves";
export * from "./apis/dailyActiveUsers";
export * from "./apis/sessionInsights";

// Stream Transformations are auto-registered via import
import "./functions/UserActivity__ParsedActivity";

/**
 * DMV2 Migration Summary:
 *
 * ✅ Data Models: Converted to DMV2 IngestPipeline pattern for complete data flow management
 * ✅ Streaming Functions: Migrated to pipeline.stream!.addTransform pattern
 * ✅ Blocks/Aggregations: Converted to MaterializedView with pipeline table references
 * ✅ APIs: Migrated to Api classes with type safety
 * ✅ Infrastructure: Single source of truth through IngestPipeline declarations
 *
 * Key Changes:
 * - IngestPipeline manages table, stream, and ingest API as a unit
 * - Type safety: All components are fully typed with generics
 * - Declarative: Resources are auto-managed by the DMV2 compiler plugin
 * - Hot reloading: Infrastructure changes are reflected instantly during development
 *
 * Pipelines Created:
 * - BrainPipeline: Brain sensor data ingestion and storage
 * - UserActivityPipeline: User activity tracking
 * - ParsedActivityPipeline: Processed user activity (derived via streaming function)
 *
 * References:
 * - Moose DMV2 Documentation: https://docs.fiveonefour.com/moose
 * - TypeScript API Reference: https://docs.fiveonefour.com/moose/reference/typescript-api-reference
 */
