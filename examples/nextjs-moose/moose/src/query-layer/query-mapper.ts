/**
 * Optional query mapping layer.
 * Maps custom API request shapes to QueryRequest structure.
 *
 * **IMPORTANT**: QueryMapper and QueryBuilder are alternatives - use one OR the other, not both.
 * - Use QueryMapper when transforming custom API request shapes (e.g., from HTTP requests)
 * - Use QueryBuilder when building queries programmatically in code
 * Both produce QueryRequest objects that get resolved and executed.
 *
 * USE THIS ONLY IF: Your API request shape differs from QueryRequest.
 * If your API already matches QueryRequest, use it directly or use QueryBuilder.
 */

import type { QueryModel } from "./query-model";
import type {
  InferRequest,
  InferDimensionNames,
  InferMetricNames,
  Names,
} from "./type-helpers";
import type { FilterParams, QueryRequest } from "./query-request";
import type { FilterDefBase } from "./filters";
import type { SortDir } from "./types";

/**
 * Query mapper interface.
 * Transforms custom API request types to QueryRequest.
 *
 * **Alternative to QueryBuilder**: Use QueryMapper for transforming custom API shapes,
 * or QueryBuilder for programmatic query building. Don't use both together.
 *
 * @template TApiRequest - Your custom API request type
 * @template TModel - QueryModel instance
 */
export interface QueryMapper<
  TApiRequest,
  TModel extends QueryModel<any, any, any, any, any, any>,
> {
  /**
   * Map API request to QueryRequest.
   * @param apiRequest - Your custom API request
   * @returns QueryRequest ready for query execution
   */
  (apiRequest: TApiRequest): InferRequest<TModel>;
}

/**
 * Extract filter types from QueryModel for type-safe mappings.
 */
type ExtractFilterTypes<
  TModel extends QueryModel<any, any, any, any, any, any>,
> =
  TModel extends QueryModel<any, any, any, infer TFilters, any, any> ? TFilters
  : never;

/**
 * Valid QueryRequest field names that can be mapped directly.
 */
type QueryRequestFieldName =
  | "dimensions"
  | "metrics"
  | "sortBy"
  | "sortDir"
  | "limit"
  | "page"
  | "offset"
  | "orderBy";

/**
 * Type-safe filter mapping for a specific filter.
 * Validates that operator is allowed for that filter.
 */
type FilterMappingForFilter<
  TFilters extends Record<string, FilterDefBase>,
  TFilterName extends keyof TFilters,
> = [
  filterName: TFilterName,
  operator: TFilters[TFilterName]["operators"][number],
];

/**
 * Union of all valid filter mappings for all filters.
 */
type FilterMapping<TFilters extends Record<string, FilterDefBase>> = {
  [K in keyof TFilters]: FilterMappingForFilter<TFilters, K>;
}[keyof TFilters];

/**
 * Type-safe field mapping configuration.
 * Validates filter names, operators, and QueryRequest field names.
 */
type MappingsConfig<
  TApiRequest,
  TMetrics extends string,
  TDimensions extends string,
  TFilters extends Record<string, FilterDefBase>,
  TSortable extends string,
> = {
  [K in keyof TApiRequest]?:
    | QueryRequestFieldName // Direct field mapping: "dimensions", "metrics", "sortBy", etc.
    | FilterMapping<TFilters>; // Filter mapping: [filterName, operator] (type-safe)
};

/**
 * Define a mapper for custom API request structures.
 * Opt-in: Only use this if your API shape differs from QueryRequest.
 *
 * **Alternative to QueryBuilder**: Use this for transforming custom API shapes,
 * or QueryBuilder for programmatic query building. Don't use both together.
 *
 * **Type Safety**: Filter names and operators are validated against the model's filter definitions.
 * Invalid filter names or operators will cause TypeScript errors.
 *
 * @template TApiRequest - Your custom API request type
 * @returns Factory function to create QueryMapper
 *
 * @example
 * // Custom API request shape (e.g., from HTTP request)
 * interface StatsApiRequest {
 *   statuses?: string[];        // Different name than "dimensions"
 *   measures?: string[];        // Different name than "metrics"
 *   minAmount?: number;         // Needs mapping to filter
 *   sortField?: string;         // Needs mapping to sortBy
 * }
 *
 * // Create mapper (alternative to QueryBuilder)
 * // TypeScript will validate that "amount" is a valid filter name
 * // and "gte" is an allowed operator for that filter
 * const mapToQueryRequest = defineMapper<StatsApiRequest>()(
 *   statsModel,
 *   {
 *     // Map API fields to QueryRequest fields
 *     statuses: "dimensions",           // Direct field mapping
 *     measures: "metrics",              // Direct field mapping
 *     sortField: "sortBy",              // Direct field mapping
 *
 *     // Map API fields to filters (type-safe!)
 *     minAmount: ["amount", "gte"],     // ✅ Validated: "amount" must exist, "gte" must be allowed
 *     // minAmount: ["invalid", "gte"], // ❌ TypeScript error: "invalid" is not a filter
 *     // minAmount: ["amount", "invalid"], // ❌ TypeScript error: "invalid" is not allowed for "amount"
 *   },
 *   {
 *     // Defaults (applied when field is undefined)
 *     statuses: ["status"],
 *     measures: ["totalEvents"],
 *   }
 * );
 *
 * // Use mapper to transform API request → QueryRequest
 * const request = mapToQueryRequest({
 *   statuses: ["active", "pending"],
 *   measures: ["totalEvents", "totalAmount"],
 *   minAmount: 100,
 * });
 * // → QueryRequest { dimensions: ["active", "pending"], metrics: [...], filters: { amount: { gte: 100 } } }
 *
 * // Execute the query
 * const results = await model.query(request, executeQuery);
 */
export function defineMapper<TApiRequest>() {
  return <TModel extends QueryModel<any, any, any, any, any, any>>(
    model: TModel,
    mappings: TModel extends (
      QueryModel<
        any,
        infer TMetrics,
        infer TDimensions,
        infer TFilters,
        infer TSortable,
        any
      >
    ) ?
      MappingsConfig<
        TApiRequest,
        Names<TMetrics>,
        Names<TDimensions>,
        TFilters extends Record<string, FilterDefBase> ? TFilters : never,
        TSortable
      >
    : never,
    defaults?: Partial<TApiRequest>,
  ): QueryMapper<TApiRequest, TModel> => {
    return (apiRequest: TApiRequest): InferRequest<TModel> => {
      const filters: Record<string, Record<string, unknown>> = {};
      const queryRequest: any = {};

      // Apply defaults
      const params = { ...defaults, ...apiRequest };

      // Process mappings
      for (const apiKey in mappings) {
        const mapping = mappings[apiKey];
        if (mapping === undefined) continue;

        const value = params[apiKey as keyof TApiRequest];
        if (value === undefined) continue;

        if (Array.isArray(mapping)) {
          // Filter mapping: [filterName, operator]
          const [filterName, operator] = mapping as [string, string];
          if (!filters[filterName]) filters[filterName] = {};
          filters[filterName][operator] = value;
        } else {
          // Direct field mapping (dimensions, metrics, sortBy, etc.)
          queryRequest[mapping as string] = value;
        }
      }

      return {
        ...queryRequest,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      } as InferRequest<TModel>;
    };
  };
}

/**
 * Direct helper: Use QueryRequest directly (no mapping needed).
 * Use this when your API request shape already matches QueryRequest.
 *
 * **Alternative approaches**:
 * - If you need to transform custom shapes → use `defineMapper()`
 * - If you're building programmatically → use `buildQuery()`
 * - If your shape already matches → use this or pass QueryRequest directly
 *
 * @template TModel - QueryModel instance
 * @param model - QueryModel instance (for type inference)
 * @param request - QueryRequest (your API shape matches QueryRequest)
 * @returns QueryRequest (same as input, type-safe)
 *
 * @example
 * // Your API request already matches QueryRequest shape
 * const request: QueryRequest = {
 *   dimensions: ["status"],
 *   metrics: ["totalEvents"],
 *   filters: { status: { eq: "active" } },
 * };
 *
 * // Use directly, no mapping needed
 * const result = await model.query(request, executeQuery);
 */
export function toQueryRequest<
  TModel extends QueryModel<any, any, any, any, any, any>,
>(model: TModel, request: InferRequest<TModel>): InferRequest<TModel> {
  return request;
}
