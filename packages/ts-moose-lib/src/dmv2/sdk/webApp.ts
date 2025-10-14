import http from "http";
import { getMooseInternal } from "../internal";

export type WebAppHandler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => void | Promise<void>;

export interface FrameworkApp {
  handle?: (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    next?: (err?: any) => void,
  ) => void;
  callback?: () => WebAppHandler;
  routing?: any;
}

export interface WebAppConfig {
  mountPath?: string;
  metadata?: { description?: string };
  injectMooseUtils?: boolean;
}

const RESERVED_MOUNT_PATHS = [
  "/admin",
  "/health",
  "/ready",
  "/workflows",
  "/ingest",
  "/api",
  "/consumption",
  "/moose",
] as const;

export class WebApp {
  name: string;
  handler: WebAppHandler;
  config: WebAppConfig;
  private _rawApp?: FrameworkApp;

  constructor(
    name: string,
    appOrHandler: FrameworkApp | WebAppHandler,
    config?: WebAppConfig,
  ) {
    this.name = name;
    this.config = config ?? {};

    // Validate mountPath
    if (this.config.mountPath) {
      const mountPath = this.config.mountPath;

      // Check for trailing slash
      if (mountPath.endsWith("/")) {
        throw new Error(
          `mountPath cannot end with a trailing slash. Remove the '/' from: "${mountPath}"`,
        );
      }

      // Check for reserved path prefixes
      for (const reserved of RESERVED_MOUNT_PATHS) {
        if (mountPath === reserved || mountPath.startsWith(`${reserved}/`)) {
          throw new Error(
            `mountPath cannot begin with a reserved path: ${RESERVED_MOUNT_PATHS.join(", ")}. Got: "${mountPath}"`,
          );
        }
      }
    }

    this.handler = this.toHandler(appOrHandler);
    this._rawApp =
      typeof appOrHandler === "function" ? undefined : appOrHandler;

    const webApps = getMooseInternal().webApps;
    if (webApps.has(name)) {
      throw new Error(`WebApp with name ${name} already exists`);
    }
    webApps.set(name, this);
  }

  private toHandler(appOrHandler: FrameworkApp | WebAppHandler): WebAppHandler {
    if (typeof appOrHandler === "function") {
      return appOrHandler as WebAppHandler;
    }

    const app = appOrHandler as FrameworkApp;

    if (typeof app.handle === "function") {
      return (req, res) => {
        app.handle!(req, res, (err?: any) => {
          if (err) {
            console.error("WebApp handler error:", err);
            if (!res.headersSent) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Internal Server Error" }));
            }
          }
        });
      };
    }

    if (typeof app.callback === "function") {
      return app.callback();
    }

    if (app.routing && typeof app.routing === "object") {
      return async (req, res) => {
        const fastifyApp = app as any;
        if (
          fastifyApp.routing &&
          typeof fastifyApp.routing.handle === "function"
        ) {
          fastifyApp.routing.handle(req, res);
        } else {
          throw new Error(
            "Fastify app detected but not properly initialized. Ensure .ready() is called before passing to WebApp.",
          );
        }
      };
    }

    throw new Error(
      `Unable to convert app to handler. The provided object must be:
      - A function (raw Node.js handler)
      - An object with .handle() method (Express, Connect)
      - An object with .callback() method (Koa)
      - An object with .routing property (Fastify after .ready())
      
Examples:
  Express: new WebApp("name", expressApp)
  Koa:     new WebApp("name", koaApp)
  Raw:     new WebApp("name", (req, res) => { ... })
      `,
    );
  }

  getRawApp(): FrameworkApp | undefined {
    return this._rawApp;
  }
}
