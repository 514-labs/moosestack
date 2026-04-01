import http from "http";
import * as path from "path";
import { getClickhouseClient } from "../commons";
import {
  MooseClient,
  QueryClient,
  RowPolicyOptions,
  RowPoliciesConfig,
  buildRowPolicyOptionsFromClaims,
  getTemporalClient,
  MOOSE_RLS_USER,
} from "./helpers";
import * as jose from "jose";
import { ClickHouseClient } from "@clickhouse/client";
import { Cluster } from "../cluster-utils";
import { sql } from "../sqlHelpers";
import { Client as TemporalClient } from "@temporalio/client";
import { getApis, getWebApps } from "../dmv2/internal";
import { getSourceDir, getOutDir } from "../compiler-config";
import { setupStructuredConsole } from "../utils/structured-logging";

interface ClickhouseConfig {
  database: string;
  host: string;
  port: string;
  username: string;
  password: string;
  useSSL: boolean;
  rlsUser?: string;
  rlsPassword?: string;
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
  rowPoliciesConfig?: RowPoliciesConfig;
}

// Convert our config to Clickhouse client config
const toClientConfig = (config: ClickhouseConfig) => ({
  ...config,
  useSSL: config.useSSL ? "true" : "false",
});

const createPath = (apisDir: string, path: string) => {
  // Always use compiled JavaScript
  return `${apisDir}${path}.js`;
};

const httpLogger = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  startMs: number,
  apiName?: string,
) => {
  const logFn = () =>
    console.log(
      `${req.method} ${req.url} ${res.statusCode} ${Date.now() - startMs}ms`,
    );

  if (apiName) {
    apiContextStorage.run({ apiName }, logFn);
  } else {
    logFn();
  }
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

interface AuthResult {
  jwtPayload?: jose.JWTPayload;
  rowPolicyOpts?: RowPolicyOptions;
}

/**
 * Verifies the JWT, enforces auth requirements, and builds RowPolicyOptions
 * from the JWT claims. Returns null if the response was already sent (auth failure).
 */
async function authenticateRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  publicKey: jose.KeyLike | undefined,
  jwtConfig: JwtConfig | undefined,
  enforceAuth: boolean,
  rowPoliciesConfig?: RowPoliciesConfig,
): Promise<AuthResult | null> {
  const requireAuth = enforceAuth || !!rowPoliciesConfig;

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
      } catch (_error) {
        console.log("JWT verification failed");
        if (requireAuth) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          return null;
        }
      }
    } else if (requireAuth) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return null;
    }
  } else if (requireAuth) {
    if (rowPoliciesConfig) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Forbidden",
          message:
            "Row policies require JWT authentication. Configure jwt.secret in moose.config.toml.",
        }),
      );
    } else {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Unauthorized",
          message:
            "Authentication is enforced but no JWT configuration is available.",
        }),
      );
    }
    return null;
  }

  let rowPolicyOpts: RowPolicyOptions | undefined;
  if (rowPoliciesConfig && jwtPayload) {
    rowPolicyOpts = buildRowPolicyOptionsFromClaims(
      rowPoliciesConfig,
      jwtPayload as Record<string, unknown>,
    );
  }

  return { jwtPayload, rowPolicyOpts };
}

const apiHandler = async (
  publicKey: jose.KeyLike | undefined,
  clickhouseClient: ClickHouseClient,
  temporalClient: TemporalClient | undefined,
  enforceAuth: boolean,
  jwtConfig?: JwtConfig,
  rowPoliciesConfig?: RowPoliciesConfig,
  rlsClickhouseClient?: ClickHouseClient,
) => {
  // Always use compiled JavaScript
  const sourceDir = getSourceDir();
  const outDir = getOutDir();
  const outRoot =
    path.isAbsolute(outDir) ? outDir : path.join(process.cwd(), outDir);
  const actualApisDir = path.join(outRoot, sourceDir, "apis");

  const apis = await getApis();
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const start = Date.now();
    // Track matched API name for structured logging - declared outside try
    // so it's accessible in catch block for error logging context
    let matchedApiName: string | undefined;

    try {
      const url = new URL(req.url || "", "http://localhost");
      const fileName = url.pathname;

      const authResult = await authenticateRequest(
        req,
        res,
        publicKey,
        jwtConfig,
        enforceAuth,
        rowPoliciesConfig,
      );
      if (!authResult) {
        httpLogger(req, res, start);
        return;
      }
      const { jwtPayload, rowPolicyOpts } = authResult;

      const pathName = createPath(actualApisDir, fileName);
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
              // Treat as name/version since full path lookup already failed at line 184
              lookupName = pathParts[0];
              version = pathParts.slice(1).join("/");
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
        modulesCache.set(cacheKey, {
          module: userFuncModule,
          apiName: matchedApiName,
        });
        apiContextStorage.run({ apiName: matchedApiName }, () => {
          console.log(`[API] | Executing API: ${matchedApiName}`);
        });
      }

      const queryClickhouseClient =
        rowPolicyOpts && rlsClickhouseClient ? rlsClickhouseClient : (
          clickhouseClient
        );
      const queryClient = new QueryClient(
        queryClickhouseClient,
        fileName,
        rowPolicyOpts,
      );

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
        httpLogger(req, res, start, apiName);
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        httpLogger(req, res, start, apiName);
      }

      res.end(body);
    } catch (error: any) {
      // Log error with API context if we know which API was being called
      const logError = () => console.log("error in path ", req.url, error);
      if (matchedApiName) {
        apiContextStorage.run({ apiName: matchedApiName }, logError);
      } else {
        logError();
      }

      // todo: same workaround as ResultSet
      if (Object.getPrototypeOf(error).constructor.name === "TypeGuardError") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
        httpLogger(req, res, start, matchedApiName);
      } else if (error?.name === "BadRequestError") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify(error.toJSON?.() ?? { error: error.message }));
        httpLogger(req, res, start, matchedApiName);
      } else if (error instanceof Error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
        httpLogger(req, res, start, matchedApiName);
      } else {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end();
        httpLogger(req, res, start, matchedApiName);
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
  rowPoliciesConfig?: RowPoliciesConfig,
  rlsClickhouseClient?: ClickHouseClient,
) => {
  const apiRequestHandler = await apiHandler(
    publicKey,
    clickhouseClient,
    temporalClient,
    enforceAuth,
    jwtConfig,
    rowPoliciesConfig,
    rlsClickhouseClient,
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

    const authResult = await authenticateRequest(
      req,
      res,
      publicKey,
      jwtConfig,
      enforceAuth,
      rowPoliciesConfig,
    );
    if (!authResult) return;
    const { jwtPayload, rowPolicyOpts } = authResult;

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
        const { getMooseUtils, runWithRequestContext } = await import(
          "./standalone"
        );

        let proxiedUrl = req.url;
        if (normalizedMount !== "/") {
          const pathWithoutMount =
            pathname.substring(normalizedMount.length) || "/";
          proxiedUrl = pathWithoutMount + url.search;
        }

        try {
          const modifiedReq = Object.assign(
            Object.create(Object.getPrototypeOf(req)),
            req,
            {
              url: proxiedUrl,
            },
          );
          // Run inside AsyncLocalStorage so getMooseUtils() picks up
          // the pre-built RowPolicyOptions without a redundant conversion.
          await runWithRequestContext(
            { rowPolicyOpts, jwt: jwtPayload },
            async () => {
              if (webApp.config.injectMooseUtils !== false) {
                (modifiedReq as any).moose = await getMooseUtils();
              }
              await webApp.handler(modifiedReq, res);
            },
          );
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

      // When RLS is configured, create a second client as the RLS user.
      // This user has the RLS role granted and is used for all API queries
      // so that row policies are enforced. The main client remains for DDL/ingest.
      let rlsClickhouseClient: ClickHouseClient | undefined;
      if (config.rowPoliciesConfig) {
        rlsClickhouseClient = getClickhouseClient(
          toClientConfig({
            ...config.clickhouseConfig,
            username: config.clickhouseConfig.rlsUser ?? MOOSE_RLS_USER,
            password:
              config.clickhouseConfig.rlsPassword ??
              config.clickhouseConfig.password,
          }),
        );
      }

      let publicKey: jose.KeyLike | undefined;
      if (config.jwtConfig?.secret) {
        console.log("Importing JWT public key...");
        publicKey = await jose.importSPKI(config.jwtConfig.secret, "RS256");
      }

      if (config.rowPoliciesConfig && !publicKey) {
        console.error(
          "WARNING: Row policies are configured but no JWT public key is set. " +
            "All consumption API requests will be rejected with 403. " +
            "Configure jwt.secret in moose.config.toml to enable authentication.",
        );
      }

      // Set runtime context for getMooseUtils() to detect
      const runtimeQueryClient = new QueryClient(clickhouseClient, "runtime");
      (globalThis as any)._mooseRuntimeContext = {
        client: new MooseClient(runtimeQueryClient, temporalClient),
        clickhouseClient,
        rlsClickhouseClient,
        temporalClient,
        rowPoliciesConfig: config.rowPoliciesConfig,
      };

      const server = http.createServer(
        await createMainRouter(
          publicKey,
          clickhouseClient,
          temporalClient,
          config.enforceAuth,
          config.jwtConfig,
          config.rowPoliciesConfig,
          rlsClickhouseClient,
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
