/**
 * @module secrets
 * Utilities for runtime environment variable resolution.
 *
 * This module provides functionality to mark values that should be resolved
 * from environment variables at runtime by the Moose CLI, rather than being
 * embedded at build time.
 *
 * @example
 * ```typescript
 * import { S3QueueEngine, mooseRuntimeEnv } from 'moose-lib';
 *
 * const table = OlapTable<MyData>(
 *   "MyTable",
 *   OlapConfig({
 *     engine: S3QueueEngine({
 *       s3_path: "s3://bucket/data/*.json",
 *       format: "JSONEachRow",
 *       awsAccessKeyId: mooseRuntimeEnv.get("AWS_ACCESS_KEY_ID"),
 *       awsSecretAccessKey: mooseRuntimeEnv.get("AWS_SECRET_ACCESS_KEY")
 *     })
 *   })
 * );
 * ```
 */

/**
 * Prefix used to mark values for runtime environment variable resolution.
 * @internal
 */
export const MOOSE_RUNTIME_ENV_PREFIX = "__MOOSE_RUNTIME_ENV__:";

/**
 * Utilities for marking values to be resolved from environment variables at runtime.
 *
 * When you use `mooseRuntimeEnv.get()`, the value is not read immediately.
 * Instead, a special marker is created that the Moose CLI will resolve when
 * it processes your infrastructure configuration.
 *
 * This is useful for:
 * - Credentials that should never be embedded in Docker images
 * - Configuration that can be rotated without rebuilding
 * - Different values for different environments (dev, staging, prod)
 * - Any runtime configuration in infrastructure elements (Tables, Topics, etc.)
 */
export const mooseRuntimeEnv = {
  /**
   * Marks a value to be resolved from an environment variable at runtime.
   *
   * @param envVarName - Name of the environment variable to resolve
   * @returns A marker string that Moose CLI will resolve at runtime
   * @throws {Error} If the environment variable name is empty
   *
   * @example
   * ```typescript
   * // Instead of this (evaluated at build time):
   * awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID
   *
   * // Use this (evaluated at runtime):
   * awsAccessKeyId: mooseRuntimeEnv.get("AWS_ACCESS_KEY_ID")
   * ```
   */
  get(envVarName: string): string {
    if (!envVarName || envVarName.trim() === "") {
      throw new Error("Environment variable name cannot be empty");
    }
    return `${MOOSE_RUNTIME_ENV_PREFIX}${envVarName}`;
  },
};

// Legacy export for backwards compatibility
/** @deprecated Use mooseRuntimeEnv instead */
export const mooseEnvSecrets = mooseRuntimeEnv;
