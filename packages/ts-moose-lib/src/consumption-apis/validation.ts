/**
 * Validation Utilities
 *
 * Request validation and error handling for API endpoints.
 *
 * @module query-layer/validation
 */

import type { IValidation } from "typia";

// --- Error Types ---

/** Frontend-friendly validation error structure */
export interface ValidationError {
  path: string;
  message: string;
  expected: string;
  received: string;
}

/** Error thrown when validation fails */
export class BadRequestError extends Error {
  public readonly errors: ValidationError[];

  constructor(typiaErrors: IValidation.IError[]) {
    super("Validation failed");
    this.name = "BadRequestError";
    this.errors = typiaErrors.map((e) => ({
      path: e.path,
      message: `Expected ${e.expected}`,
      expected: e.expected,
      received: typeof e.value === "undefined" ? "undefined" : String(e.value),
    }));
  }

  toJSON() {
    return { error: this.message, details: this.errors };
  }
}

/** Assert validation result, throw BadRequestError if invalid */
export function assertValid<T>(result: IValidation<T>): T {
  if (!result.success) {
    throw new BadRequestError(result.errors);
  }
  return result.data;
}

// --- Query Handler ---

/**
 * Query handler with three entry points for queries.
 * Use this when writing raw SQL without a query model.
 */
export interface QueryHandler<P, R> {
  run: (params: P) => Promise<R>;
  fromObject: (input: unknown) => Promise<R>;
  fromUrl: (url: string | URL) => Promise<R>;
}

/**
 * Create a simple query handler with validation.
 *
 * @example
 * const handler = createQueryHandler({
 *   fromUrl: typia.http.createValidateQuery<MyParams>(),
 *   fromObject: typia.createValidate<MyParams>(),
 *   queryFn: async (params) => {
 *     const query = sql`SELECT * FROM ${Table} ${where(...)}`;
 *     return executeQuery(query);
 *   },
 * });
 */
export function createQueryHandler<P, R>(config: {
  fromUrl: (input: string | URLSearchParams) => IValidation<P>;
  fromObject: (input: unknown) => IValidation<P>;
  queryFn: (params: P) => Promise<R>;
}): QueryHandler<P, R> {
  return {
    run: config.queryFn,
    fromObject: (input) =>
      config.queryFn(assertValid(config.fromObject(input))),
    fromUrl: (url) => {
      // Dummy base required by URL constructor to parse relative paths
      // like "/api?foo=bar". Only .searchParams is used; the host is discarded.
      const searchParams =
        typeof url === "string" ?
          new URL(url, "http://localhost").searchParams
        : url.searchParams;
      return config.queryFn(assertValid(config.fromUrl(searchParams)));
    },
  };
}
