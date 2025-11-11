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
 * When you use `mooseRuntimeEnv.get()`, the behavior depends on the context:
 * - During infrastructure map loading: Returns a marker string for later resolution
 * - During function/workflow execution: Returns the actual environment variable value
 *
 * This is useful for:
 * - Credentials that should never be embedded in Docker images
 * - Configuration that can be rotated without rebuilding
 * - Different values for different environments (dev, staging, prod)
 * - Any runtime configuration in infrastructure elements (Tables, Topics, etc.)
 */
export const mooseRuntimeEnv = {
  /**
   * Gets a value from an environment variable, with behavior depending on context.
   *
   * When IS_LOADING_INFRA_MAP=true (infrastructure loading):
   *   Returns a marker string that Moose CLI will resolve later
   *
   * When IS_LOADING_INFRA_MAP is unset (function/workflow runtime):
   *   Returns the actual value from the environment variable
   *
   * @param envVarName - Name of the environment variable to resolve
   * @returns Either a marker string or the actual environment variable value
   * @throws {Error} If the environment variable name is empty
   * @throws {Error} If the environment variable is not set (runtime mode only)
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

    // Check if we're loading infrastructure map
    const isLoadingInfraMap = process.env.IS_LOADING_INFRA_MAP === "true";

    if (isLoadingInfraMap) {
      // Return marker string for later resolution by Moose CLI
      return `${MOOSE_RUNTIME_ENV_PREFIX}${envVarName}`;
    } else {
      // Return actual value from environment for runtime execution
      const value = process.env[envVarName];
      if (value === undefined) {
        throw new Error(
          `Environment variable '${envVarName}' is not set. ` +
            `This is required for runtime execution of functions/workflows.`,
        );
      }
      return value;
    }
  },
};

// Legacy export for backwards compatibility
/** @deprecated Use mooseRuntimeEnv instead */
export const mooseEnvSecrets = mooseRuntimeEnv;
