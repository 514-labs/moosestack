import http from "http";
import { getClickhouseClient } from "../commons";
import { MooseClient, QueryClient, getTemporalClient } from "./helpers";
import * as jose from "jose";
import { ClickHouseClient } from "@clickhouse/client";
import { Cluster } from "../cluster-utils";
import { ApiUtil } from "../index";
import { sql } from "../sqlHelpers";
import { Client as TemporalClient } from "@temporalio/client";
import { getApis, getWebApps } from "../dmv2/internal";
import {
  getSourceDir,
  shouldUseCompiled,
  loadModule,
} from "../compiler-config";
import { setupStructuredConsole } from "../utils/structured-logging";

interface ClickhouseConfig {
  database: string;
  host: string;
  port: string;
  username: string;
  password: string;
  useSSL: boolean;
}

interface JwtConfig {
  secret?: string;
  issuer: string;
  audience: string;
}

interface TemporalConfig {
  url: string;
  namespace: string;
  clientCert: string;
  clientKey: string;
  apiKey: string;
}

interface ApisConfig {
  clickhouseConfig: ClickhouseConfig;
  jwtConfig?: JwtConfig;
  temporalConfig?: TemporalConfig;
  enforceAuth: boolean;
  proxyPort?: number;
  workerCount?: number;
}

// Convert our config to Clickhouse client config
const toClientConfig = (config: ClickhouseConfig) => ({
  ...config,
  useSSL: config.useSSL ? "true" : "false",
});

const createPath = (apisDir: string, path: string, useCompiled: boolean) => {
  const extension = useCompiled ? ".js" : ".ts";
  return `${apisDir}${path}${extension}`;
};

const httpLogger = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  startMs: number,
) => {
  console.log(
    `${req.method} ${req.url} ${res.statusCode} ${Date.now() - startMs}ms`,
  );
};

// Cache stores both the module and the matched API name for structured logging
interface CachedApiEntry {
  module: any;
  apiName: string;
}
const modulesCache = new Map<string, CachedApiEntry>();

// Set up structured console logging for API context
const apiContextStorage = setupStructuredConsole<{ apiName: string }>(
  (ctx) => ctx.apiName,
  "api_name",
);

export function createApi<T extends object, R = any>(
  _handler: (params: T, utils: ApiUtil) => Promise<R>,
): (
  rawParams: Record<string, string[] | string>,
  utils: ApiUtil,
) => Promise<R> {
  throw new Error(
    "This should be compiled-time replaced by compiler plugins to add parsing.",
  );
}

/** @deprecated Use `Api` from "dmv2/sdk/consumptionApi" instead. */
export const createConsumptionApi = createApi;

const apiHandler = async (
  publicKey: jose.KeyLike | undefined,
  clickhouseClient: ClickHouseClient,
  temporalClient: TemporalClient | undefined,
  enforceAuth: boolean,
  jwtConfig?: JwtConfig,
) => {
  // Check if we should use compiled code
  const useCompiled = shouldUseCompiled();
  const sourceDir = getSourceDir();

  // Adjust apisDir for compiled mode
  const actualApisDir =
    useCompiled ?
      `${process.cwd()}/.moose/compiled/${sourceDir}/apis/`
    : undefined;

  const apis = await getApis();
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const start = Date.now();

    try {
      const url = new URL(req.url || "", "http://localhost");
      const fileName = url.pathname;

      let jwtPayload: jose.JWTPayload | undefined;
      if (publicKey && jwtConfig) {
        const jwt = req.headers.authorization?.split(" ")[1]; // Bearer <token>
        if (jwt) {
          try {
            const { payload } = await jose.jwtVerify(jwt, publicKey, {
              issuer: jwtConfig.issuer,
              audience: jwtConfig.audience,
            });
            jwtPayload = payload;
          } catch (error) {
            console.log("JWT verification failed");
            if (enforceAuth) {
              res.writeHead(401, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Unauthorized" }));
              httpLogger(req, res, start);
              return;
            }
          }
        } else if (enforceAuth) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          httpLogger(req, res, start);
          return;
        }
      } else if (enforceAuth) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        httpLogger(req, res, start);
        return;
      }

      const pathName =
        actualApisDir ?
          createPath(actualApisDir, fileName, useCompiled)
        : fileName;
      const paramsObject = Array.from(url.searchParams.entries()).reduce(
        (obj: { [key: string]: string[] | string }, [key, value]) => {
          const existingValue = obj[key];
          if (existingValue) {
            if (Array.isArray(existingValue)) {
              existingValue.push(value);
            } else {
              obj[key] = [existingValue, value];
            }
          } else {
            obj[key] = value;
          }
          return obj;
        },
        {},
      );

      // Include version query param in cache key to avoid collisions
      // Path-based versions (/myapi/1) are already in pathName, but query versions (?version=1) are not
      const versionParam = url.searchParams.get("version");
      const cacheKey = versionParam ? `${pathName}:${versionParam}` : pathName;

      // Track matched API name for structured logging - must match source_primitive.name in infra map
      let matchedApiName: string | undefined;
      let userFuncModule: any;

      const cachedEntry = modulesCache.get(cacheKey);
      if (cachedEntry !== undefined) {
        userFuncModule = cachedEntry.module;
        matchedApiName = cachedEntry.apiName;
      } else {
        let lookupName = fileName.replace(/^\/+|\/+$/g, "");
        let version: string | null = null;

        // First, try to find the API by the full path (for custom paths)
        userFuncModule = apis.get(lookupName);
        if (userFuncModule) {
          // For custom path lookup, the key IS the API name
          matchedApiName = lookupName;
        }

        if (!userFuncModule) {
          // Fall back to the old name:version parsing
          version = url.searchParams.get("version");

          // Check if version is in the path (e.g., /bar/1)
          if (!version && lookupName.includes("/")) {
            const pathParts = lookupName.split("/");
            if (pathParts.length >= 2) {
              // Try the full path first (it might be a custom path)
              userFuncModule = apis.get(lookupName);
              if (userFuncModule) {
                matchedApiName = lookupName;
              } else {
                // If not found, treat it as name/version
                lookupName = pathParts[0];
                version = pathParts.slice(1).join("/");
              }
            }
          }

          // Only do versioned lookup if we still haven't found it
          if (!userFuncModule && version) {
            const versionedKey = `${lookupName}:${version}`;
            userFuncModule = apis.get(versionedKey);
            if (userFuncModule) {
              // The API name is the base name without version
              matchedApiName = lookupName;
            }
          }

          // Try unversioned lookup if still not found
          if (!userFuncModule) {
            userFuncModule = apis.get(lookupName);
            if (userFuncModule) {
              matchedApiName = lookupName;
            }
          }
        }

        if (!userFuncModule || matchedApiName === undefined) {
          const availableApis = Array.from(apis.keys()).map((key) =>
            key.replace(":", "/"),
          );
          const errorMessage =
            version ?
              `API ${lookupName} with version ${version} not found. Available APIs: ${availableApis.join(", ")}`
            : `API ${lookupName} not found. Available APIs: ${availableApis.join(", ")}`;
          throw new Error(errorMessage);
        }

        // Cache both the module and API name for future requests
        modulesCache.set(cacheKey, { module: userFuncModule, apiName: matchedApiName });
        console.log(`[API] | Executing API: ${matchedApiName}`);
      }

      const queryClient = new QueryClient(clickhouseClient, fileName);

      // Use matched API name for structured logging context
      // This matches source_primitive.name in the infrastructure map
      // Note: matchedApiName is guaranteed to be defined here (either from cache or lookup)
      const apiName = matchedApiName!;

      // Use AsyncLocalStorage to set context for this API call.
      // This avoids race conditions from concurrent API requests - each async
      // execution chain has its own isolated context value
      const result = await apiContextStorage.run({ apiName }, async () => {
        return await userFuncModule(paramsObject, {
          client: new MooseClient(queryClient, temporalClient),
          sql: sql,
          jwt: jwtPayload,
        });
      });
      let body: string;
      let status: number | undefined;

      // TODO investigate why these prototypes are different
      if (Object.getPrototypeOf(result).constructor.name === "ResultSet") {
        body = JSON.stringify(await result.json());
      } else {
        if ("body" in result && "status" in result) {
          body = JSON.stringify(result.body);
          status = result.status;
        } else {
          body = JSON.stringify(result);
        }
      }

      if (status) {
        res.writeHead(status, { "Content-Type": "application/json" });
        httpLogger(req, res, start);
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        httpLogger(req, res, start);
      }

      res.end(body);
    } catch (error: any) {
      console.log("error in path ", req.url, error);
      // todo: same workaround as ResultSet
      if (Object.getPrototypeOf(error).constructor.name === "TypeGuardError") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
        httpLogger(req, res, start);
      }
      if (error instanceof Error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
        httpLogger(req, res, start);
      } else {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end();
        httpLogger(req, res, start);
      }
    }
  };
};

const createMainRouter = async (
  publicKey: jose.KeyLike | undefined,
  clickhouseClient: ClickHouseClient,
  temporalClient: TemporalClient | undefined,
  enforceAuth: boolean,
  jwtConfig?: JwtConfig,
) => {
  const apiRequestHandler = await apiHandler(
    publicKey,
    clickhouseClient,
    temporalClient,
    enforceAuth,
    jwtConfig,
  );

  const webApps = await getWebApps();

  const sortedWebApps = Array.from(webApps.values()).sort((a, b) => {
    const pathA = a.config.mountPath || "/";
    const pathB = b.config.mountPath || "/";
    return pathB.length - pathA.length;
  });

  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const start = Date.now();

    const url = new URL(req.url || "", "http://localhost");
    const pathname = url.pathname;

    // Health check - checked before all other routes
    if (pathname === "/_moose_internal/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          timestamp: new Date().toISOString(),
        }),
      );
      return;
    }

    let jwtPayload: jose.JWTPayload | undefined;
    if (publicKey && jwtConfig) {
      const jwt = req.headers.authorization?.split(" ")[1];
      if (jwt) {
        try {
          const { payload } = await jose.jwtVerify(jwt, publicKey, {
            issuer: jwtConfig.issuer,
            audience: jwtConfig.audience,
          });
          jwtPayload = payload;
        } catch (error) {
          console.log("JWT verification failed for WebApp route");
        }
      }
    }

    for (const webApp of sortedWebApps) {
      const mountPath = webApp.config.mountPath || "/";
      const normalizedMount =
        mountPath.endsWith("/") && mountPath !== "/" ?
          mountPath.slice(0, -1)
        : mountPath;

      const matches =
        pathname === normalizedMount ||
        pathname.startsWith(normalizedMount + "/");

      if (matches) {
        if (webApp.config.injectMooseUtils !== false) {
          // Import getMooseUtils dynamically to avoid circular deps
          const { getMooseUtils } = await import("./standalone");
          (req as any).moose = await getMooseUtils();
        }

        let proxiedUrl = req.url;
        if (normalizedMount !== "/") {
          const pathWithoutMount =
            pathname.substring(normalizedMount.length) || "/";
          proxiedUrl = pathWithoutMount + url.search;
        }

        try {
          // Create a modified request preserving all properties including headers
          // A shallow clone (like { ...req }) generally will not work since headers and other
          // members are not cloned.
          const modifiedReq = Object.assign(
            Object.create(Object.getPrototypeOf(req)),
            req,
            {
              url: proxiedUrl,
            },
          );
          await webApp.handler(modifiedReq, res);
          return;
        } catch (error) {
          console.error(`Error in WebApp ${webApp.name}:`, error);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal Server Error" }));
          }
          return;
        }
      }
    }

    // If no WebApp matched, check if it's an Api request
    // Strip /api or /consumption prefix for Api routing
    let apiPath = pathname;
    if (pathname.startsWith("/api/")) {
      apiPath = pathname.substring(4); // Remove "/api"
    } else if (pathname.startsWith("/consumption/")) {
      apiPath = pathname.substring(13); // Remove "/consumption"
    }

    // If we stripped a prefix, it's an Api request
    if (apiPath !== pathname) {
      // Create a modified request with the rewritten URL for the apiHandler
      // Preserve all properties including headers by using Object.assign with prototype chain
      // A shallow clone (like { ...req }) generally will not work since headers and other
      // members are not cloned.
      const modifiedReq = Object.assign(
        Object.create(Object.getPrototypeOf(req)),
        req,
        {
          url: apiPath + url.search,
        },
      );
      await apiRequestHandler(modifiedReq as http.IncomingMessage, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not Found" }));
    httpLogger(req, res, start);
  };
};

export const runApis = async (config: ApisConfig) => {
  const apisCluster = new Cluster({
    maxWorkerCount:
      (config.workerCount ?? 0) > 0 ? config.workerCount : undefined,
    workerStart: async () => {
      let temporalClient: TemporalClient | undefined;
      if (config.temporalConfig) {
        temporalClient = await getTemporalClient(
          config.temporalConfig.url,
          config.temporalConfig.namespace,
          config.temporalConfig.clientCert,
          config.temporalConfig.clientKey,
          config.temporalConfig.apiKey,
        );
      }
      const clickhouseClient = getClickhouseClient(
        toClientConfig(config.clickhouseConfig),
      );
      let publicKey: jose.KeyLike | undefined;
      if (config.jwtConfig?.secret) {
        console.log("Importing JWT public key...");
        publicKey = await jose.importSPKI(config.jwtConfig.secret, "RS256");
      }

      // Set runtime context for getMooseUtils() to detect
      const runtimeQueryClient = new QueryClient(clickhouseClient, "runtime");
      (globalThis as any)._mooseRuntimeContext = {
        client: new MooseClient(runtimeQueryClient, temporalClient),
      };

      const server = http.createServer(
        await createMainRouter(
          publicKey,
          clickhouseClient,
          temporalClient,
          config.enforceAuth,
          config.jwtConfig,
        ),
      );
      // port is now passed via config.proxyPort or defaults to 4001
      const port = config.proxyPort !== undefined ? config.proxyPort : 4001;
      server.listen(port, "localhost", () => {
        console.log(`Server running on port ${port}`);
      });

      return server;
    },
    workerStop: async (server) => {
      return new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  });

  apisCluster.start();
};
