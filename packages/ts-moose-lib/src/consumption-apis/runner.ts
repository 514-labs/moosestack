import http from "http";
import { getClickhouseClient } from "../commons";
import { MooseClient, QueryClient, getTemporalClient } from "./helpers";
import * as jose from "jose";
import { ClickHouseClient } from "@clickhouse/client";
import { Cluster } from "../cluster-utils";
import { ApiUtil } from "../index";
import { sql } from "../sqlHelpers";
import { Client as TemporalClient } from "@temporalio/client";
import { getApis } from "../dmv2/internal";
import { loadByofApps, logCollisions, type ByofAppInfo } from "./byof-loader";
import type { FrameworkAdapter } from "./byof-adapter";

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
  apisDir: string;
  clickhouseConfig: ClickhouseConfig;
  jwtConfig?: JwtConfig;
  temporalConfig?: TemporalConfig;
  enforceAuth: boolean;
  isDmv2: boolean;
  proxyPort?: number;
}

// Convert our config to Clickhouse client config
const toClientConfig = (config: ClickhouseConfig) => ({
  ...config,
  useSSL: config.useSSL ? "true" : "false",
});

const createPath = (apisDir: string, path: string) => `${apisDir}${path}.ts`;

const httpLogger = (req: http.IncomingMessage, res: http.ServerResponse) => {
  console.log(`${req.method} ${req.url} ${res.statusCode}`);
};

const modulesCache = new Map<string, any>();

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
  apisDir: string,
  enforceAuth: boolean,
  isDmv2: boolean,
  jwtConfig?: JwtConfig,
) => {
  const apis = isDmv2 ? await getApis() : new Map();
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      const url = new URL(req.url || "", "http://localhost");
      const fileName = url.pathname;

      let jwtPayload;
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
              httpLogger(req, res);
              return;
            }
          }
        } else if (enforceAuth) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
          httpLogger(req, res);
          return;
        }
      } else if (enforceAuth) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        httpLogger(req, res);
        return;
      }

      const pathName = createPath(apisDir, fileName);
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

      let userFuncModule = modulesCache.get(pathName);
      if (userFuncModule === undefined) {
        if (isDmv2) {
          let apiName = fileName.replace(/^\/+|\/+$/g, "");
          let version: string | null = null;

          // First, try to find the API by the full path (for custom paths)
          userFuncModule = apis.get(apiName);

          if (!userFuncModule) {
            // Fall back to the old name:version parsing
            version = url.searchParams.get("version");

            // Check if version is in the path (e.g., /bar/1)
            if (!version && apiName.includes("/")) {
              const pathParts = apiName.split("/");
              if (pathParts.length >= 2) {
                // Try the full path first (it might be a custom path)
                userFuncModule = apis.get(apiName);
                if (!userFuncModule) {
                  // If not found, treat it as name/version
                  apiName = pathParts[0];
                  version = pathParts.slice(1).join("/");
                }
              }
            }

            // Only do versioned lookup if we still haven't found it
            if (!userFuncModule) {
              if (version) {
                const versionedKey = `${apiName}:${version}`;
                userFuncModule = apis.get(versionedKey);
              } else {
                userFuncModule = apis.get(apiName);
              }
            }
          }

          if (!userFuncModule) {
            const availableApis = Array.from(apis.keys()).map((key) =>
              key.replace(":", "/"),
            );
            const errorMessage =
              version ?
                `API ${apiName} with version ${version} not found. Available APIs: ${availableApis.join(", ")}`
              : `API ${apiName} not found. Available APIs: ${availableApis.join(", ")}`;
            throw new Error(errorMessage);
          }

          modulesCache.set(pathName, userFuncModule);
          console.log(`[API] | Executing API: ${apiName}`);
        } else {
          userFuncModule = require(pathName);
          modulesCache.set(pathName, userFuncModule);
        }
      }

      const queryClient = new QueryClient(clickhouseClient, fileName);
      let result =
        isDmv2 ?
          await userFuncModule(paramsObject, {
            client: new MooseClient(queryClient, temporalClient),
            sql: sql,
            jwt: jwtPayload,
          })
        : await userFuncModule.default(paramsObject, {
            client: new MooseClient(queryClient, temporalClient),
            sql: sql,
            jwt: jwtPayload,
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
        httpLogger(req, res);
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        httpLogger(req, res);
      }

      res.end(body);
    } catch (error: any) {
      console.log("error in path ", req.url, error);
      // todo: same workaround as ResultSet
      if (Object.getPrototypeOf(error).constructor.name === "TypeGuardError") {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
        httpLogger(req, res);
      }
      if (error instanceof Error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
        httpLogger(req, res);
      } else {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end();
        httpLogger(req, res);
      }
    }
  };
};

/**
 * Creates a combined request handler that tries Api routes first, then BYOF apps.
 * This ensures Api instances take precedence over custom framework routes.
 */
const createCombinedHandler = async (
  publicKey: jose.KeyLike | undefined,
  clickhouseClient: ClickHouseClient,
  temporalClient: TemporalClient | undefined,
  apisDir: string,
  enforceAuth: boolean,
  isDmv2: boolean,
  jwtConfig: JwtConfig | undefined,
  byofApps: ByofAppInfo[],
): Promise<
  (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>
> => {
  // Get the standard Api handler
  const standardApiHandler = await apiHandler(
    publicKey,
    clickhouseClient,
    temporalClient,
    apisDir,
    enforceAuth,
    isDmv2,
    jwtConfig,
  );

  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    // Track if response was sent
    let responseSent = false;

    // Create a wrapper response to detect when Api handler sends response
    const originalEnd = res.end.bind(res);
    const originalWriteHead = res.writeHead.bind(res);

    res.end = ((...args: any[]) => {
      responseSent = true;
      return (originalEnd as any)(...args);
    }) as any;

    res.writeHead = ((...args: any[]) => {
      responseSent = true;
      return (originalWriteHead as any)(...args);
    }) as any;

    // Try Api handler first
    try {
      await standardApiHandler(req, res);

      // If Api handler responded, we're done
      if (responseSent) {
        return;
      }

      // Api handler didn't respond (404), try BYOF apps
      if (byofApps.length > 0) {
        for (const byofApp of byofApps) {
          const handled = await byofApp.adapter.handleRequest(req, res);
          if (handled) {
            return;
          }
        }
      }

      // Nothing handled the request, send 404
      if (!responseSent) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not Found" }));
        httpLogger(req, res);
      }
    } catch (error) {
      if (!responseSent) {
        console.error("Error in combined handler:", error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error:
              error instanceof Error ? error.message : "Internal Server Error",
          }),
        );
        httpLogger(req, res);
      }
    }
  };
};

export const runApis = async (config: ApisConfig) => {
  const apisCluster = new Cluster({
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

      // Load BYOF (Bring Your Own Framework) apps
      let byofApps: ByofAppInfo[] = [];
      try {
        const { apps, collisions } = await loadByofApps(config.apisDir);
        byofApps = apps;

        if (apps.length > 0) {
          console.log(`[BYOF] Loaded ${apps.length} custom framework app(s)`);
        }

        // Log any route collisions
        if (collisions.length > 0) {
          logCollisions(collisions);
        }
      } catch (error) {
        console.warn(
          `[BYOF] Warning: Failed to load BYOF apps: ${error instanceof Error ? error.message : error}`,
        );
      }

      // Create combined handler that tries Api routes first, then BYOF apps
      const combinedHandler = await createCombinedHandler(
        publicKey,
        clickhouseClient,
        temporalClient,
        config.apisDir,
        config.enforceAuth,
        config.isDmv2,
        config.jwtConfig,
        byofApps,
      );

      const server = http.createServer(combinedHandler);
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
