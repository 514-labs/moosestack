import { type FrameworkAdapter } from "./byof-adapter";
import { getMooseInternal } from "../dmv2/internal";
import { getRegisteredByofApp, type RegisteredByofApp } from "./byof-registry";

/**
 * Information about a loaded BYOF (Bring Your Own Framework) application
 */
export interface ByofAppInfo {
  /** The framework adapter for this app */
  adapter: FrameworkAdapter;
  /** Routes defined by this app */
  routes: string[];
}

/**
 * Result of loading BYOF apps, including any route collisions detected
 */
export interface ByofLoadResult {
  /** Successfully loaded BYOF apps */
  apps: ByofAppInfo[];
  /** Route collisions between BYOF apps and Api instances */
  collisions: RouteCollision[];
}

/**
 * Represents a route collision between a BYOF app and a Moose Api instance
 */
export interface RouteCollision {
  /** The route path that collides */
  route: string;
  /** The Api instance name that also uses this route */
  apiName: string;
}

/**
 * Loads the registered BYOF application and checks for route collisions.
 *
 * @returns Promise<ByofLoadResult> - The loaded app and any detected collisions
 */
export async function loadByofApps(): Promise<ByofLoadResult> {
  const apps: ByofAppInfo[] = [];
  const collisions: RouteCollision[] = [];

  // Get the registered BYOF app from the registry
  const registeredApp = getRegisteredByofApp();

  if (!registeredApp) {
    // No BYOF app registered, return empty result
    return { apps, collisions };
  }

  // Add the registered app to the list
  apps.push({
    adapter: registeredApp.adapter,
    routes: registeredApp.routes,
  });

  // Detect collisions with Api instances
  collisions.push(...(await detectCollisions(apps)));

  return { apps, collisions };
}

/**
 * Detects route collisions between BYOF apps and Moose Api instances.
 *
 * @param apps - The loaded BYOF apps
 * @returns Promise<RouteCollision[]> - Array of detected collisions
 */
async function detectCollisions(
  apps: ByofAppInfo[],
): Promise<RouteCollision[]> {
  const collisions: RouteCollision[] = [];

  // Get all registered Api instances from the internal registry
  const registry = getMooseInternal();
  if (!registry) {
    // Registry not available, skip collision detection
    return collisions;
  }

  const apis = registry.apis;

  // Build a map of Api routes
  const apiRoutes = new Map<string, string>();
  for (const [key, api] of apis.entries()) {
    // Construct the route path for this Api
    let routePath: string;
    if (api.config?.path) {
      routePath = api.config.path;
      if (api.config.version) {
        const pathEndsWithVersion =
          api.config.path.endsWith(`/${api.config.version}`) ||
          api.config.path === api.config.version;
        if (!pathEndsWithVersion) {
          routePath = `${api.config.path}/${api.config.version}`;
        }
      }
    } else {
      routePath =
        api.config?.version ? `${api.name}/${api.config.version}` : api.name;
    }

    // Normalize the route path (add leading slash if missing)
    if (!routePath.startsWith("/")) {
      routePath = `/${routePath}`;
    }

    apiRoutes.set(routePath, api.name);
  }

  // Check each BYOF route against Api routes
  for (const app of apps) {
    for (const route of app.routes) {
      // Extract path from "METHOD path" format
      const routePath = route.includes(" ") ? route.split(" ")[1] : route;

      // Check if this route collides with an Api route
      for (const [apiRoute, apiName] of apiRoutes.entries()) {
        if (routesCollide(routePath, apiRoute)) {
          collisions.push({
            route: routePath,
            apiName,
          });
        }
      }
    }
  }

  return collisions;
}

/**
 * Checks if two routes collide (i.e., would match the same request path).
 *
 * This is a simplified check that handles exact matches and common patterns.
 * A more sophisticated implementation could handle route parameters and wildcards.
 *
 * @param route1 - First route path
 * @param route2 - Second route path
 * @returns boolean - true if routes collide
 */
function routesCollide(route1: string, route2: string): boolean {
  // Normalize routes (remove trailing slashes, ensure leading slash)
  const normalize = (route: string) => {
    let normalized = route.trim();
    if (!normalized.startsWith("/")) {
      normalized = `/${normalized}`;
    }
    if (normalized.endsWith("/") && normalized.length > 1) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  };

  const r1 = normalize(route1);
  const r2 = normalize(route2);

  // Exact match
  if (r1 === r2) {
    return true;
  }

  // Check if one route is a prefix of the other (considering /api prefix)
  // For example, /moose and /api/moose don't collide, but /foo and /api/foo might
  const withApiPrefix = (route: string) =>
    route.startsWith("/api/") ? route : `/api${route}`;

  if (withApiPrefix(r1) === withApiPrefix(r2)) {
    return true;
  }

  return false;
}

/**
 * Logs route collisions to the console with appropriate warnings.
 *
 * @param collisions - Array of route collisions to log
 */
export function logCollisions(collisions: RouteCollision[]): void {
  if (collisions.length === 0) {
    return;
  }

  console.warn("\n⚠️  Route Collision Warnings:");
  console.warn("═".repeat(60));

  for (const collision of collisions) {
    console.warn(
      `\n  Route: ${collision.route}\n  - Api instance: ${collision.apiName}\n  → Api instance takes precedence`,
    );
  }

  console.warn("\n" + "═".repeat(60));
  console.warn(
    "Note: Api instances take precedence over BYOF routes when collisions occur.\n",
  );
}
