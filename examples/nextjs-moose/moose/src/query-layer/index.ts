/**
 * Query Layer - Type-safe SQL query building for Moose.
 *
 * This module provides a semantic layer for building type-safe SQL queries with:
 * - Predefined dimensions and metrics
 * - Type-safe filtering with operator validation
 * - Configurable sorting and pagination
 * - Fluent builder API for dynamic queries
 * - Custom SQL assembly via QueryParts
 *
 * @module query-layer
 */

// Core types
export * from "./types";

// Field definitions
export * from "./fields";

// Filter definitions
export * from "./filters";

// Query request types (user-facing)
export * from "./query-request";

// Resolved query spec (internal - not exported to users)
// Note: ResolvedQuerySpec is internal and should not be exported

// Type inference helpers
export * from "./type-helpers";

// Query model (main API)
export * from "./query-model";

// Fluent query builder
export * from "./query-builder";

// Optional query mapping layer
export * from "./query-mapper";

// Utilities (SQL building functions)
export * from "./utils";
