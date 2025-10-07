import * as fs from "fs";
import * as path from "path";
import { createFrameworkAdapter, type FrameworkAdapter } from "./byof-adapter";
import { getMooseInternal } from "../dmv2/internal";

/**
 * Information about a loaded BYOF (Bring Your Own Framework) application
 */
export interface ByofAppInfo {
  /** The file path where this app was loaded from */
  filePath: string;
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
  /** The BYOF app file that defines this route */
  byofFile: string;
  /** The Api instance name that also uses this route */
  apiName: string;
}

/**
 * Scans a directory for BYOF application files and loads them.
 *
 * A BYOF file must export an async function called `createApp` that returns
 * a framework application (currently only Express is supported).
 *
 * @param apisDir - The directory to scan for API files
 * @returns Promise<ByofLoadResult> - The loaded apps and any detected collisions
 */
export async function loadByofApps(apisDir: string): Promise<ByofLoadResult> {
  const apps: ByofAppInfo[] = [];
  const collisions: RouteCollision[] = [];

  // Check if directory exists
  if (!fs.existsSync(apisDir)) {
    return { apps, collisions };
  }

  // Get all .ts and .js files recursively
  const files = getAllFiles(apisDir);

  // Try to load each file
  for (const file of files) {
    try {
      const module = require(file);

      // Check if the module exports a createApp function
      if (typeof module.createApp === "function") {
        console.log(`[BYOF] Found BYOF app in ${file}`);

        // Call createApp to get the framework app instance
        const app = await module.createApp();

        // Create an adapter for the app
        const adapter = createFrameworkAdapter(app);

        // Get routes from the adapter
        const routes = adapter.getRoutes();

        console.log(
          `[BYOF] Loaded ${adapter.frameworkName} app with ${routes.length} routes`,
        );

        apps.push({
          filePath: file,
          adapter,
          routes,
        });
      }
    } catch (error) {
      // If the file can't be loaded or doesn't export createApp, skip it silently
      // This allows regular Api files to coexist in the same directory
      if (error instanceof Error && !error.message.includes("Cannot find")) {
        console.warn(
          `[BYOF] Warning: Failed to load ${file}: ${error.message}`,
        );
      }
    }
  }

  // Detect collisions with Api instances
  if (apps.length > 0) {
    collisions.push(...(await detectCollisions(apps)));
  }

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
            byofFile: app.filePath,
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
 * Recursively gets all .ts and .js files in a directory.
 *
 * @param dirPath - Directory path to scan
 * @param arrayOfFiles - Accumulator for recursive calls
 * @returns string[] - Array of file paths
 */
function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const filePath = path.join(dirPath, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      // Skip node_modules and hidden directories
      if (!file.startsWith(".") && file !== "node_modules") {
        getAllFiles(filePath, arrayOfFiles);
      }
    } else if (file.endsWith(".ts") || file.endsWith(".js")) {
      // Skip test and type definition files
      if (!file.endsWith(".test.ts") && !file.endsWith(".d.ts")) {
        arrayOfFiles.push(filePath);
      }
    }
  }

  return arrayOfFiles;
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
      `\n  Route: ${collision.route}\n  - BYOF app: ${collision.byofFile}\n  - Api instance: ${collision.apiName}\n  → Api instance takes precedence`,
    );
  }

  console.warn("\n" + "═".repeat(60));
  console.warn(
    "Note: Api instances take precedence over BYOF routes when collisions occur.\n",
  );
}
