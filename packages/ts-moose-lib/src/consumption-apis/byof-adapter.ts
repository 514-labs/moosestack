import type http from "http";

/**
 * Interface for framework adapters that can integrate with Moose's consumption API server.
 * Each framework (Express, Fastify, etc.) implements this interface to provide
 * a consistent way to handle HTTP requests.
 */
export interface FrameworkAdapter {
  /**
   * The name of the framework (e.g., "express", "fastify")
   */
  frameworkName: string;

  /**
   * Handle an HTTP request using the framework's routing logic.
   * Returns true if the request was handled, false if it should fall through.
   *
   * @param req - The incoming HTTP request
   * @param res - The HTTP response object
   * @returns Promise<boolean> - true if handled, false if not handled
   */
  handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<boolean>;

  /**
   * Get all routes defined in this framework app for collision detection.
   * Returns an array of route patterns (e.g., ["/api/users", "/api/products/:id"])
   */
  getRoutes(): string[];

  /**
   * Clean up resources when the server is shutting down
   */
  cleanup?(): Promise<void>;
}

/**
 * Type guard to check if an object is an Express application.
 * Uses duck typing to detect Express apps by their method signatures.
 */
export function isExpressApp(app: any): boolean {
  return (
    typeof app === "function" &&
    typeof app.use === "function" &&
    typeof app.get === "function" &&
    typeof app.listen === "function" &&
    typeof app.handle === "function"
  );
}

/**
 * Type guard to check if an object is a Fastify application.
 * Uses duck typing to detect Fastify apps by their method signatures.
 */
export function isFastifyApp(app: any): boolean {
  return (
    typeof app === "object" &&
    typeof app.register === "function" &&
    typeof app.ready === "function" &&
    app.server !== undefined
  );
}

/**
 * Express adapter that integrates Express applications with Moose's consumption API server.
 */
export class ExpressAdapter implements FrameworkAdapter {
  frameworkName = "express";
  private app: any;

  constructor(app: any) {
    if (!isExpressApp(app)) {
      throw new Error(
        "Provided app is not a valid Express application. Ensure it has use, get, listen, and handle methods.",
      );
    }
    this.app = app;
  }

  async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      // Track if the response was sent
      let responseSent = false;

      // Override res.end to detect when Express sends a response
      const originalEnd = res.end.bind(res);
      res.end = ((...args: any[]): any => {
        responseSent = true;
        return (originalEnd as any)(...args);
      }) as any;

      // Set up a fallback to detect if Express didn't handle the request
      const originalWriteHead = res.writeHead.bind(res);
      res.writeHead = ((...args: any[]): any => {
        responseSent = true;
        return (originalWriteHead as any)(...args);
      }) as any;

      // Use Express's handle method to process the request
      this.app.handle(req, res, () => {
        // This callback is called if no route matched
        resolve(false);
      });

      // If Express handled the request, it will have sent a response
      // We use setImmediate to check after the current event loop
      setImmediate(() => {
        if (responseSent) {
          resolve(true);
        }
      });
    });
  }

  getRoutes(): string[] {
    const routes: string[] = [];

    // Extract routes from Express app._router.stack
    if (this.app._router && this.app._router.stack) {
      for (const layer of this.app._router.stack) {
        if (layer.route) {
          // Regular routes
          const methods = Object.keys(layer.route.methods)
            .filter((method) => layer.route.methods[method])
            .map((m) => m.toUpperCase());
          routes.push(`${methods.join(",")} ${layer.route.path}`);
        } else if (layer.name === "router" && layer.handle.stack) {
          // Nested routers
          for (const subLayer of layer.handle.stack) {
            if (subLayer.route) {
              const methods = Object.keys(subLayer.route.methods)
                .filter((method) => subLayer.route.methods[method])
                .map((m) => m.toUpperCase());
              const basePath =
                layer.regexp.toString().match(/^\/\^\\([^\\]*)\\/)?.[1] || "";
              routes.push(
                `${methods.join(",")} ${basePath}${subLayer.route.path}`,
              );
            }
          }
        }
      }
    }

    return routes;
  }
}

/**
 * Creates an appropriate framework adapter based on the app type.
 * Uses duck typing to detect the framework and return the correct adapter.
 *
 * @param app - The framework app object (Express, Fastify, etc.)
 * @returns FrameworkAdapter instance
 * @throws Error if the framework is not supported
 */
export function createFrameworkAdapter(app: any): FrameworkAdapter {
  if (isExpressApp(app)) {
    return new ExpressAdapter(app);
  }

  if (isFastifyApp(app)) {
    throw new Error(
      "Fastify support is not yet implemented. Currently only Express is supported.",
    );
  }

  throw new Error(
    "Unsupported framework. The app must be an Express application (or Fastify in the future).",
  );
}
