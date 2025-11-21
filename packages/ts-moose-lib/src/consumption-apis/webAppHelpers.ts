import http from "http";
import crypto from "crypto";
import type { ApiUtil } from "./helpers";

/**
 * Constant-time string comparison to prevent timing attacks.
 *
 * Regular string comparison (===) stops at the first different character,
 * which can leak information about the correct token through timing measurements.
 */
function constantTimeCompare(a: string, b: string): boolean {
  try {
    // If lengths differ, timingSafeEqual throws, so check first
    if (a.length !== b.length) {
      return false;
    }

    const bufA = Buffer.from(a, "utf8") as unknown as Uint8Array;
    const bufB = Buffer.from(b, "utf8") as unknown as Uint8Array;

    return crypto.timingSafeEqual(bufA, bufB);
  } catch (error) {
    // timingSafeEqual throws if buffer lengths don't match
    return false;
  }
}

export function getMooseUtils(
  req: http.IncomingMessage | any,
): ApiUtil | undefined {
  return (req as any).moose;
}

export function expressMiddleware() {
  return (req: any, res: any, next: any) => {
    if (!req.moose && req.raw && (req.raw as any).moose) {
      req.moose = (req.raw as any).moose;
    }
    next();
  };
}

export interface ExpressRequestWithMoose {
  moose?: ApiUtil;
}

// Export for testing
export { constantTimeCompare };
