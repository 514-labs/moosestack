import { createFrameworkAdapter, type FrameworkAdapter } from "./byof-adapter";

/**
 * Configuration for a BYOF API
 */
export interface ByofApiConfig {
  /** Optional version string for this API configuration */
  version?: string;
  /** Optional metadata */
  metadata?: { description?: string };
}

/**
 * Represents a Bring Your Own Framework (BYOF) API that integrates a custom
 * framework (Express, Fastify, etc.) with Moose's consumption API server.
 *
 * This class follows the same pattern as `Api` and `IngestApi`, allowing users
 * to register their own framework applications alongside Moose's built-in APIs.
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { ByofApi, getMooseClients, mooseLogger, sql } from '@514labs/moose-lib';
 *
 * async function createExpressApp() {
 *   const app = express();
 *   const { client } = await getMooseClients();
 *
 *   app.use(mooseLogger);
 *
 *   app.get('/custom-route', async (req, res) => {
 *     const result = await client.query.execute(sql`SELECT * FROM MyTable`);
 *     res.json(await result.json());
 *   });
 *
 *   return app;
 * }
 *
 * // Register the Express app with Moose
 * export const myByofApi = new ByofApi(
 *   'my-express-app',
 *   createExpressApp,
 *   { version: '1.0' }
 * );
 * ```
 */
export class ByofApi {
  /** The name of this BYOF API */
  readonly name: string;

  /** Configuration for this BYOF API */
  readonly config: ByofApiConfig;

  /** Function that creates and returns the framework app */
  private readonly createApp: () => Promise<any> | any;

  /** @internal Cached adapter instance */
  private _adapter?: FrameworkAdapter;

  /** @internal Cached routes */
  private _routes?: string[];

  /**
   * Creates a new ByofApi instance.
   *
   * @param name - The name of this BYOF API (used for logging and identification)
   * @param createApp - Function that creates and returns your framework app
   * @param config - Optional configuration
   */
  constructor(
    name: string,
    createApp: () => Promise<any> | any,
    config?: ByofApiConfig,
  ) {
    this.name = name;
    this.config = config ?? {};
    this.createApp = createApp;

    // Register this instance in the global registry
    const registry = getByofRegistry();
    registry.register(this);
  }

  /**
   * Initializes the framework app and creates the adapter.
   * Called internally by the consumption runner.
   *
   * @internal
   */
  async initialize(): Promise<void> {
    if (this._adapter) {
      // Already initialized
      return;
    }

    const app = await this.createApp();
    this._adapter = createFrameworkAdapter(app);
    this._routes = this._adapter.getRoutes();

    console.log(
      `[BYOF] Initialized ${this._adapter.frameworkName} app "${this.name}" with ${this._routes.length} routes`,
    );
  }

  /**
   * Gets the adapter for this BYOF API.
   * Must call initialize() first.
   *
   * @internal
   */
  getAdapter(): FrameworkAdapter {
    if (!this._adapter) {
      throw new Error(
        `ByofApi "${this.name}" has not been initialized. Call initialize() first.`,
      );
    }
    return this._adapter;
  }

  /**
   * Gets the routes defined by this BYOF API.
   * Must call initialize() first.
   *
   * @internal
   */
  getRoutes(): string[] {
    if (!this._routes) {
      throw new Error(
        `ByofApi "${this.name}" has not been initialized. Call initialize() first.`,
      );
    }
    return this._routes;
  }
}

/**
 * Internal registry for ByofApi instances.
 * Ensures only one BYOF API is registered per runtime.
 */
class ByofApiRegistry {
  private instance: ByofApi | null = null;

  /**
   * Registers a ByofApi instance.
   * Can only be called once per runtime.
   */
  register(api: ByofApi): void {
    if (this.instance) {
      throw new Error(
        `A BYOF API has already been registered: "${this.instance.name}". ` +
          `Cannot register "${api.name}" because only one BYOF API is allowed per runtime.`,
      );
    }

    this.instance = api;
    console.log(`[BYOF] Registered BYOF API: ${api.name}`);
  }

  /**
   * Gets the registered ByofApi instance, if any.
   */
  getInstance(): ByofApi | null {
    return this.instance;
  }

  /**
   * Checks if a ByofApi has been registered.
   */
  isRegistered(): boolean {
    return this.instance !== null;
  }

  /**
   * Clears the registry. Used for testing.
   * @internal
   */
  _reset(): void {
    this.instance = null;
  }
}

// Global singleton instance
let globalRegistry: ByofApiRegistry | undefined;

/**
 * Gets the global ByofApi registry.
 * @internal
 */
function getByofRegistry(): ByofApiRegistry {
  if (!globalRegistry) {
    globalRegistry = new ByofApiRegistry();
  }
  return globalRegistry;
}

/**
 * Gets the registered ByofApi instance, if any.
 * Used internally by the consumption runner.
 *
 * @internal
 */
export function getRegisteredByofApi(): ByofApi | null {
  return getByofRegistry().getInstance();
}

/**
 * Checks if a ByofApi has been registered.
 * Used internally by the consumption runner.
 *
 * @internal
 */
export function isByofApiRegistered(): boolean {
  return getByofRegistry().isRegistered();
}

/**
 * Clears the ByofApi registry. Used for testing.
 *
 * @internal
 */
export function _resetByofApiRegistry(): void {
  getByofRegistry()._reset();
}
