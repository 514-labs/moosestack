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
 *
 * timingSafeEqual() will throw if buffer lengths don't match, which is caught
 * and returned as false. This prevents timing leaks from length comparisons.
 */
function constantTimeCompare(a: string, b: string): boolean {
  try {
    // Convert to utf16le buffers to preserve all string data
    const bufA = Buffer.from(a, "utf16le") as unknown as Uint8Array;
    const bufB = Buffer.from(b, "utf16le") as unknown as Uint8Array;

    // timingSafeEqual throws if lengths differ, preventing timing leaks
    return crypto.timingSafeEqual(bufA, bufB);
  } catch (error) {
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

/**
 * Validates API keys configuration at runtime.
 * Checks that MOOSE_WEB_APP_API_KEYS is set and warns about weak keys.
 *
 * @returns Array of valid API keys or false if not configured
 */
function getValidApiKeys(): string[] | false {
  const apiKeysString = process.env.MOOSE_WEB_APP_API_KEYS;

  if (!apiKeysString) {
    console.warn(
      `[API Auth] Warning: API endpoints will be unavailable. MOOSE_WEB_APP_API_KEYS must be set in the env.`,
    );
    return false;
  }

  const keys = apiKeysString
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

  if (keys.length === 0) {
    console.warn(
      `[API Auth] Warning: API endpoints will be unavailable. MOOSE_WEB_APP_API_KEYS is configured but contains no valid keys.`,
    );
    return false;
  }

  // Validate key strength
  const MIN_KEY_LENGTH = 32;
  const weakKeys = keys.filter((k) => k.length < MIN_KEY_LENGTH);

  if (weakKeys.length > 0) {
    console.warn(
      `[API Auth] Warning: ${weakKeys.length} API key(s) are shorter than ${MIN_KEY_LENGTH} characters. ` +
        `Recommend using cryptographically secure keys of at least ${MIN_KEY_LENGTH} characters.`,
    );
  }

  return keys;
}

/**
 * Express middleware for API key authentication using PBKDF2 HMAC SHA256.
 *
 * Validates API keys from `Authorization: Bearer <token>` headers against
 * configured hashes in `MOOSE_WEB_APP_API_KEYS` environment variable.
 *
 * @returns Express middleware function (req, res, next) => void
 *
 * @example
 * ```typescript
 * import express from "express";
 * import { expressApiKeyAuthMiddleware } from "@514labs/moose-lib";
 *
 * const app = express();
 *
 * // Protect all routes
 * app.use(expressApiKeyAuthMiddleware());
 *
 * // Or protect specific routes
 * app.get("/api/protected", expressApiKeyAuthMiddleware(), (req, res) => {
 *   res.json({ message: "Success" });
 * });
 * ```
 *
 * **Environment Configuration:**
 * - `MOOSE_WEB_APP_API_KEYS`: Comma-separated PBKDF2 hashes (required)
 * - Generate keys using: `moose generate hash-token`
 *
 * **Security Notes:**
 * - Uses PBKDF2 with SHA256 (1000 iterations, 20 byte key)
 * - Constant-time comparison prevents timing attacks
 * - Supports multiple keys for rotation
 * - Fails secure: rejects all requests if keys not configured
 *
 * **Returns 401 Unauthorized if:**
 * - `MOOSE_WEB_APP_API_KEYS` environment variable is not set
 * - Authorization header is missing or malformed
 * - API key doesn't match any configured hash
 */
export function expressApiKeyAuthMiddleware(): (
  req: any,
  res: any,
  next: any,
) => void {
  return (req: any, res: any, next: any): void => {
    const validApiKeys = getValidApiKeys();

    // If no API keys configured, reject all requests (fail secure)
    if (!validApiKeys) {
      console.log("[API Auth] Rejected: MOOSE_WEB_APP_API_KEYS not configured");
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    const authHeader = req.headers.authorization;

    if (!authHeader) {
      console.log("[API Auth] Rejected: Missing Authorization header");
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    // Extract token from "Bearer <token>" format
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      console.log("[API Auth] Rejected: Invalid Authorization header format");
      return res.status(401).json({
        error: "Unauthorized",
      });
    }

    const providedToken = parts[1];

    // Validate against all configured keys using PBKDF2 validation
    const isValid = validApiKeys.some((validKey) =>
      validateAuthToken(providedToken, validKey),
    );

    if (isValid) {
      console.log("[API Auth] Authenticated: Valid API key");
      return next();
    } else {
      console.log("[API Auth] Rejected: Invalid API key");
      return res.status(401).json({
        error: "Unauthorized",
      });
    }
  };
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

// Export for testing (internal functions)
export { constantTimeCompare, validateAuthToken, getValidApiKeys };
