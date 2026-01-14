import { sql, Sql } from "@514labs/moose-lib";
import type { IValidation } from "typia";

/**
 * Create raw SQL (literal string, no parameterization).
 */
function raw(text: string): Sql {
  return new Sql([text], []);
}

/**
 * Join an array of SQL fragments with a separator.
 */
export function joinSql(fragments: Sql[], separator: string = ","): Sql {
  if (fragments.length === 0) return sql``;
  if (fragments.length === 1) return fragments[0];

  const sep = raw(separator.includes(" ") ? separator : ` ${separator} `);
  return fragments
    .slice(1)
    .reduce((acc, frag) => sql`${acc}${sep}${frag}`, fragments[0]);
}

/**
 * Frontend-friendly validation error structure.
 */
export interface ValidationError {
  path: string;
  message: string;
  expected: string;
  received: string;
}

export class BadRequestError extends Error {
  public readonly errors: ValidationError[];

  constructor(typiaErrors: IValidation.IError[]) {
    super("Validation failed");
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

export function assertValid<T>(result: IValidation<T>): T {
  if (!result.success) {
    throw new BadRequestError(result.errors);
  }
  return result.data;
}

/**
 * Query handler with three entry points:
 * - run: execute with typed params directly
 * - fromObject: validate unknown input → run
 * - fromUrl: parse & validate URL params → run
 */
export interface QueryHandler<P, R> {
  run: (params: P) => Promise<R>;
  fromObject: (input: unknown) => Promise<R>;
  fromUrl: (url: string | URL) => Promise<R>;
}

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
      const search =
        typeof url === "string" ?
          new URL(url, "http://localhost").search
        : url.search;
      return config.queryFn(assertValid(config.fromUrl(search)));
    },
  };
}
