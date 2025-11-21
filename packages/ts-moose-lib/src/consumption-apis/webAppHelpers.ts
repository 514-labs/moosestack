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

/**
 * Validates an API key token against an expected PBKDF2 hash.
 *
 * Token format: "token_hex.salt_hex" (e.g., "abc123.def456")
 * The function recomputes the PBKDF2 hash using the token and salt,
 * then compares it with the expected hash using constant-time comparison.
 *
 * Matches the Rust implementation in framework-cli/src/cli/routines/auth.rs
 */
function validateAuthToken(token: string, expectedHash: string): boolean {
  const tokenParts = token.split(".");
  if (tokenParts.length !== 2) {
    return false;
  }

  const tokenHex = tokenParts[0];
  const saltHex = tokenParts[1];

  // Validate non-empty parts
  if (!tokenHex || !saltHex) {
    return false;
  }

  // PBKDF2 with SHA256, 1000 iterations, 20 byte key (matches Rust implementation)
  const key = crypto.pbkdf2Sync(tokenHex, saltHex, 1000, 20, "sha256");

  const computedHash = key.toString("hex");

  // Constant-time comparison to prevent timing attacks
  return constantTimeCompare(computedHash, expectedHash);
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
export { constantTimeCompare, validateAuthToken };
