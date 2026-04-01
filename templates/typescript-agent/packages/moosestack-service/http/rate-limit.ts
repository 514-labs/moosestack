import type express from "express";
import rateLimit from "express-rate-limit";

type RateLimitOptions = Parameters<typeof rateLimit>[0];

export interface RouteRateLimitOverride {
  method?: string | string[];
  path: string | RegExp;
}

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 60;

function normalizeMethods(method?: string | string[]): string[] | undefined {
  if (!method) {
    return undefined;
  }

  return (Array.isArray(method) ? method : [method]).map((entry) =>
    entry.toUpperCase(),
  );
}

export function matchesRouteRateLimitOverride(
  req: Pick<express.Request, "method" | "path">,
  override: RouteRateLimitOverride,
): boolean {
  const methods = normalizeMethods(override.method);
  if (methods && !methods.includes(req.method.toUpperCase())) {
    return false;
  }

  if (typeof override.path === "string") {
    return req.path === override.path;
  }

  return override.path.test(req.path);
}

export function shouldSkipDefaultRateLimit(
  req: Pick<express.Request, "method" | "path">,
  overrides: RouteRateLimitOverride[],
): boolean {
  return overrides.some((override) =>
    matchesRouteRateLimitOverride(req, override),
  );
}

function createRateLimitResponseHandler() {
  return (_req, res, _next, options) => {
    res.status(options.statusCode).json({
      error: "Too many requests",
      details: "Rate limit exceeded. Try again soon.",
    });
  };
}

function createBaseRateLimit(
  options?: RateLimitOptions,
): express.RequestHandler {
  return rateLimit({
    windowMs: DEFAULT_WINDOW_MS,
    limit: DEFAULT_LIMIT,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: createRateLimitResponseHandler(),
    ...options,
  });
}

export function createDefaultApiRateLimit(
  overrides: RouteRateLimitOverride[] = [],
  options?: RateLimitOptions,
): express.RequestHandler {
  const callerSkip = options?.skip;

  return createBaseRateLimit({
    ...options,
    skip: (req, res) =>
      shouldSkipDefaultRateLimit(req, overrides) ||
      callerSkip?.(req, res) === true,
  });
}

export function createRouteRateLimit(
  options?: RateLimitOptions,
): express.RequestHandler {
  return createBaseRateLimit(options);
}
