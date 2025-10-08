import { createFrameworkAdapter, type FrameworkAdapter } from "./byof-adapter";

/**
 * Information about a registered BYOF (Bring Your Own Framework) application
 */
export interface RegisteredByofApp {
  /** The framework adapter for this app */
  adapter: FrameworkAdapter;
  /** Routes defined by this app */
  routes: string[];
}

/**
 * Global registry for BYOF applications.
 * Ensures only one app is registered per runtime.
 */
class ByofRegistry {
  private app: RegisteredByofApp | null = null;
  private registered = false;

  /**
   * Registers a BYOF application (Express, Fastify, etc.).
   * Can only be called once per runtime.
   *
   * @param frameworkApp - The framework application instance (e.g., Express app)
   * @throws Error if an app has already been registered
   */
  register(frameworkApp: any): void {
    if (this.registered) {
      throw new Error(
        "A BYOF app has already been registered. You can only register one custom framework app per runtime.",
      );
    }

    try {
      const adapter = createFrameworkAdapter(frameworkApp);
      const routes = adapter.getRoutes();

      this.app = {
        adapter,
        routes,
      };

      this.registered = true;

      console.log(
        `[BYOF] Registered ${adapter.frameworkName} app with ${routes.length} routes`,
      );
    } catch (error) {
      throw new Error(
        `Failed to register BYOF app: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Gets the registered BYOF app, if any.
   *
   * @returns The registered app or null if none registered
   */
  getRegisteredApp(): RegisteredByofApp | null {
    return this.app;
  }

  /**
   * Checks if a BYOF app has been registered.
   *
   * @returns true if an app is registered
   */
  isRegistered(): boolean {
    return this.registered;
  }

  /**
   * Clears the registered app. Used for testing.
   * @internal
   */
  _reset(): void {
    this.app = null;
    this.registered = false;
  }
}

// Global singleton instance
const byofRegistry = new ByofRegistry();

/**
 * Registers a custom framework application (Express, Fastify, etc.) to be used
 * alongside Moose consumption APIs.
 *
 * This function must be called with your framework app instance. It can only be
 * called once per runtime to ensure a single, well-defined BYOF app.
 *
 * The registered app will run on the same port as Moose consumption APIs (default 4001),
 * with Moose `Api` instances taking precedence when route collisions occur.
 *
 * @param frameworkApp - Your framework application (e.g., Express app created with `express()`)
 * @throws Error if called more than once or if the framework is not supported
 *
 * @example
 * ```typescript
 * import express from 'express';
 * import { registerApp, getMooseClients, mooseLogger, sql } from '@514labs/moose-lib';
 *
 * const app = express();
 * const { client } = await getMooseClients();
 *
 * app.use(mooseLogger);
 *
 * app.get('/custom-route', async (req, res) => {
 *   const result = await client.query.execute(sql`SELECT * FROM MyTable`);
 *   res.json(await result.json());
 * });
 *
 * registerApp(app);
 * ```
 */
export function registerApp(frameworkApp: any): void {
  byofRegistry.register(frameworkApp);
}

/**
 * Gets the registered BYOF app, if any.
 * Used internally by the consumption runner.
 *
 * @internal
 * @returns The registered app or null if none registered
 */
export function getRegisteredByofApp(): RegisteredByofApp | null {
  return byofRegistry.getRegisteredApp();
}

/**
 * Checks if a BYOF app has been registered.
 * Used internally by the consumption runner.
 *
 * @internal
 * @returns true if an app is registered
 */
export function isByofAppRegistered(): boolean {
  return byofRegistry.isRegistered();
}

/**
 * Clears the registered BYOF app. Used for testing.
 *
 * @internal
 */
export function _resetByofRegistry(): void {
  byofRegistry._reset();
}
