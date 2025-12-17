import http from "http";
import type { MooseUtils } from "./helpers";

/**
 * @deprecated Use getMooseUtils() directly instead.
 * This function previously extracted moose utilities from the request object.
 * Now getMooseUtils() can be called without any parameters.
 */
export function getMooseUtils(
  req: http.IncomingMessage | any,
): MooseUtils | undefined {
  console.warn(
    "[DEPRECATED] getMooseUtils(req) from webAppHelpers is deprecated. " +
      "Import getMooseUtils from '@514labs/moose-lib' and call it without parameters.",
  );
  return (req as any).moose;
}

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
