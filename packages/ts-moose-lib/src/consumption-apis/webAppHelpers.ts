import http from "http";
import crypto from "crypto";
import type { ApiUtil } from "./helpers";

/**
 * Constant-time string comparison to prevent timing attacks.
 *
 * Regular string comparison (===) stops at the first different character,
 * which can leak information about the correct token through timing measurements.
 *
 * Uses utf16le encoding because it's the only Node.js encoding that doesn't
 * lose information (utf8 normalizes lone surrogates, latin1 truncates multi-byte
 * characters, base64 drops whitespace, etc.)
 */
function constantTimeCompare(a: string, b: string): boolean {
  try {
    // Early return if lengths differ (length is typically not secret for API keys)
    if (a.length !== b.length) {
      return false;
    }

    // Convert to utf16le buffers to preserve all string data
    const bufA = Buffer.from(a, "utf16le") as unknown as Uint8Array;
    const bufB = Buffer.from(b, "utf16le") as unknown as Uint8Array;

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
