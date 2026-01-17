import http from "http";
import type { MooseUtils } from "./helpers";

/**
 * @deprecated Use `getMooseUtils()` from '@514labs/moose-lib' instead.
 *
 * This synchronous function extracts MooseUtils from a request object that was
 * injected by Moose runtime middleware. It returns undefined if not running
 * in a Moose-managed context.
 *
 * Migration: Replace with the async version:
 * ```typescript
 * // Old (sync, deprecated):
 * import { getMooseUtilsFromRequest } from '@514labs/moose-lib';
 * const moose = getMooseUtilsFromRequest(req);
 *
 * // New (async, recommended):
 * import { getMooseUtils } from '@514labs/moose-lib';
 * const moose = await getMooseUtils();
 * ```
 *
 * @param req - The HTTP request object containing injected moose utilities
 * @returns MooseUtils if available on the request, undefined otherwise
 */
export function getMooseUtilsFromRequest(
  req: http.IncomingMessage | any,
): MooseUtils | undefined {
  console.warn(
    "[DEPRECATED] getMooseUtilsFromRequest() is deprecated. " +
      "Import getMooseUtils from '@514labs/moose-lib' and call it without parameters: " +
      "const { client, sql } = await getMooseUtils();",
  );
  return (req as any).moose;
}

/**
 * @deprecated Use `getMooseUtils()` from '@514labs/moose-lib' instead.
 *
 * This is a legacy alias for getMooseUtilsFromRequest. The main getMooseUtils
 * export from '@514labs/moose-lib' is now async and does not require a request parameter.
 *
 * BREAKING CHANGE WARNING: The new getMooseUtils() returns Promise<MooseUtils>,
 * not MooseUtils | undefined. You must await the result:
 * ```typescript
 * const moose = await getMooseUtils(); // New async API
 * ```
 */
export const getLegacyMooseUtils = getMooseUtilsFromRequest;

/**
 * @deprecated No longer needed. Use getMooseUtils() directly instead.
 * Moose now handles utility injection automatically when injectMooseUtils is true.
 */
export function expressMiddleware() {
  console.warn(
    "[DEPRECATED] expressMiddleware() is deprecated. " +
      "Use getMooseUtils() directly or rely on injectMooseUtils config.",
  );
  return (req: any, res: any, next: any) => {
    // Maintain backwards compat: copy req.raw.moose to req.moose if present
    if (!req.moose && req.raw && (req.raw as any).moose) {
      req.moose = (req.raw as any).moose;
    }
    next();
  };
}

/**
 * @deprecated Use MooseUtils from helpers.ts instead.
 */
export interface ExpressRequestWithMoose {
  moose?: MooseUtils;
}
