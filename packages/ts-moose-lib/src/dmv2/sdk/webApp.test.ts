import { expect } from "chai";
import { getMooseInternal } from "../internal";
import { WebApp, FrameworkApp, WebAppHandler } from "./webApp";
import http from "http";

describe("WebApp", () => {
  beforeEach(() => {
    getMooseInternal().webApps.clear();
  });

  describe("WebApp Creation", () => {
    it("should create WebApp with raw Node.js handler function", () => {
      const handler: WebAppHandler = (req, res) => {
        res.writeHead(200);
        res.end("OK");
      };

      const webApp = new WebApp("testApp", handler, { mountPath: "/test" });

      expect(webApp.name).to.equal("testApp");
      expect(webApp.handler).to.be.a("function");
      expect(webApp.config.mountPath).to.equal("/test");
      expect(webApp.getRawApp()).to.be.undefined;
    });

    it("should create WebApp with Express-like app (handle method)", () => {
      const expressApp: FrameworkApp = {
        handle: (req: any, res: any, next?: any) => {
          res.writeHead(200);
          res.end("Express");
        },
      };

      const webApp = new WebApp("expressApp", expressApp, {
        mountPath: "/express",
      });

      expect(webApp.name).to.equal("expressApp");
      expect(webApp.handler).to.be.a("function");
      expect(webApp.getRawApp()).to.equal(expressApp);
    });

    it("should create WebApp with Koa-like app (callback method)", () => {
      const koaApp: FrameworkApp = {
        callback: () => (req: any, res: any) => {
          res.writeHead(200);
          res.end("Koa");
        },
      };

      const webApp = new WebApp("koaApp", koaApp, { mountPath: "/koa" });

      expect(webApp.name).to.equal("koaApp");
      expect(webApp.handler).to.be.a("function");
      expect(webApp.getRawApp()).to.equal(koaApp);
    });

    it("should create WebApp with Fastify-like app (routing function)", () => {
      const fastifyApp: FrameworkApp = {
        routing: (req: any, res: any) => {
          res.writeHead(200);
          res.end("Fastify");
        },
      };

      const webApp = new WebApp("fastifyApp", fastifyApp, {
        mountPath: "/fastify",
      });

      expect(webApp.name).to.equal("fastifyApp");
      expect(webApp.handler).to.be.a("function");
      expect(webApp.getRawApp()).to.equal(fastifyApp);
    });

    it("should throw error when mountPath is not provided", () => {
      const handler: WebAppHandler = (req, res) => {
        res.end("OK");
      };

      expect(() => {
        new WebApp("minimalApp", handler, {} as any);
      }).to.throw("mountPath is required");
    });

    it("should create WebApp with full config", () => {
      const handler: WebAppHandler = (req, res) => {
        res.end("OK");
      };

      const config = {
        mountPath: "/custom",
        metadata: { description: "Test API" },
        injectMooseUtils: true,
      };

      const webApp = new WebApp("fullConfigApp", handler, config);

      expect(webApp.config.mountPath).to.equal("/custom");
      expect(webApp.config.metadata?.description).to.equal("Test API");
      expect(webApp.config.injectMooseUtils).to.be.true;
    });
  });

  describe("Configuration Validation", () => {
    it("should reject root mountPath '/'", () => {
      const handler: WebAppHandler = (req, res) => {
        res.end("OK");
      };

      expect(() => {
        new WebApp("testApp", handler, { mountPath: "/" });
      }).to.throw(
        'mountPath cannot be "/" as it would allow routes to overlap with reserved paths',
      );
    });

    it("should reject mountPath with trailing slash", () => {
      const handler: WebAppHandler = (req, res) => {
        res.end("OK");
      };

      expect(() => {
        new WebApp("testApp", handler, { mountPath: "/api/" });
      }).to.throw("mountPath cannot end with a trailing slash");
    });

    it("should reject reserved mountPath: /admin", () => {
      expect(() => {
        new WebApp("test", () => {}, { mountPath: "/admin" });
      }).to.throw("mountPath cannot begin with a reserved path");
    });

    it("should reject reserved mountPath: /api", () => {
      expect(() => {
        new WebApp("test", () => {}, { mountPath: "/api" });
      }).to.throw("mountPath cannot begin with a reserved path");
    });

    it("should reject reserved mountPath: /consumption", () => {
      expect(() => {
        new WebApp("test", () => {}, { mountPath: "/consumption" });
      }).to.throw("mountPath cannot begin with a reserved path");
    });

    it("should reject reserved mountPath: /health", () => {
      expect(() => {
        new WebApp("test", () => {}, { mountPath: "/health" });
      }).to.throw("mountPath cannot begin with a reserved path");
    });

    it("should reject reserved mountPath: /ingest", () => {
      expect(() => {
        new WebApp("test", () => {}, { mountPath: "/ingest" });
      }).to.throw("mountPath cannot begin with a reserved path");
    });

    it("should reject reserved mountPath: /moose", () => {
      expect(() => {
        new WebApp("test", () => {}, { mountPath: "/moose" });
      }).to.throw("mountPath cannot begin with a reserved path");
    });

    it("should reject reserved mountPath: /ready", () => {
      expect(() => {
        new WebApp("test", () => {}, { mountPath: "/ready" });
      }).to.throw("mountPath cannot begin with a reserved path");
    });

    it("should reject reserved mountPath: /workflows", () => {
      expect(() => {
        new WebApp("test", () => {}, { mountPath: "/workflows" });
      }).to.throw("mountPath cannot begin with a reserved path");
    });

    it("should reject reserved mountPath with sub-paths: /admin/panel", () => {
      expect(() => {
        new WebApp("test", () => {}, { mountPath: "/admin/panel" });
      }).to.throw("mountPath cannot begin with a reserved path");
    });

    it("should reject reserved mountPath with sub-paths: /api/v1", () => {
      expect(() => {
        new WebApp("test", () => {}, { mountPath: "/api/v1" });
      }).to.throw("mountPath cannot begin with a reserved path");
    });

    it("should accept valid custom mountPaths", () => {
      expect(() => {
        new WebApp("test1", () => {}, { mountPath: "/custom" });
      }).to.not.throw();

      expect(() => {
        new WebApp("test2", () => {}, { mountPath: "/myapi" });
      }).to.not.throw();

      expect(() => {
        new WebApp("test3", () => {}, { mountPath: "/v1/users" });
      }).to.not.throw();
    });

    it("should handle metadata configuration correctly", () => {
      const webApp = new WebApp("metadataApp", () => {}, {
        mountPath: "/metadata",
        metadata: {
          description: "This is a test API with metadata",
        },
      });

      expect(webApp.config.metadata?.description).to.equal(
        "This is a test API with metadata",
      );
    });
  });

  describe("Registration Tests", () => {
    it("should register WebApp in moose internal upon creation", () => {
      const webApp = new WebApp("registeredApp", () => {}, {
        mountPath: "/registered",
      });

      const internal = getMooseInternal();
      expect(internal.webApps.has("registeredApp")).to.be.true;
      expect(internal.webApps.get("registeredApp")).to.equal(webApp);
    });

    it("should throw error when creating WebApp with duplicate name", () => {
      new WebApp("duplicateName", () => {}, { mountPath: "/duplicate1" });

      expect(() => {
        new WebApp("duplicateName", () => {}, { mountPath: "/duplicate2" });
      }).to.throw("WebApp with name duplicateName already exists");
    });

    it("should throw error when creating WebApp with duplicate mountPath", () => {
      new WebApp("app1", () => {}, { mountPath: "/custom" });

      expect(() => {
        new WebApp("app2", () => {}, { mountPath: "/custom" });
      }).to.throw(
        'WebApp with mountPath "/custom" already exists (used by WebApp "app1")',
      );
    });

    it("should allow multiple WebApps with different names and mountPaths", () => {
      const app1 = new WebApp("app1", () => {}, { mountPath: "/path1" });
      const app2 = new WebApp("app2", () => {}, { mountPath: "/path2" });
      const app3 = new WebApp("app3", () => {}, { mountPath: "/path3" });

      const internal = getMooseInternal();
      expect(internal.webApps.size).to.equal(3);
      expect(internal.webApps.get("app1")).to.equal(app1);
      expect(internal.webApps.get("app2")).to.equal(app2);
      expect(internal.webApps.get("app3")).to.equal(app3);
    });

    it("should allow multiple WebApps with unique mountPaths", () => {
      const app1 = new WebApp("app1", () => {}, { mountPath: "/multi1" });
      const app2 = new WebApp("app2", () => {}, { mountPath: "/multi2" });

      const internal = getMooseInternal();
      expect(internal.webApps.size).to.equal(2);
      expect(internal.webApps.get("app1")).to.equal(app1);
      expect(internal.webApps.get("app2")).to.equal(app2);
    });
  });

  describe("Framework Adapter Tests", () => {
    it("should convert Express app to handler correctly", () => {
      let handlerCalled = false;
      const expressApp: FrameworkApp = {
        handle: (req: any, res: any, next?: any) => {
          handlerCalled = true;
          res.writeHead(200);
          res.end("Express");
        },
      };

      const webApp = new WebApp("expressApp", expressApp, {
        mountPath: "/express-test",
      });

      // Create mock request/response
      const req = {} as http.IncomingMessage;
      const res = {
        writeHead: () => {},
        end: () => {},
        headersSent: false,
      } as any;

      webApp.handler(req, res);
      expect(handlerCalled).to.be.true;
    });

    it("should handle errors in Express middleware chain", () => {
      const expressApp: FrameworkApp = {
        handle: (req: any, res: any, next?: any) => {
          const error = new Error("Middleware error");
          if (next) {
            next(error);
          }
        },
      };

      const webApp = new WebApp("expressApp", expressApp, {
        mountPath: "/express-error",
      });

      // Create mock request/response
      const req = {} as http.IncomingMessage;
      const res = {
        writeHead: () => {},
        end: () => {},
        headersSent: false,
      } as any;

      // Should not throw
      expect(() => {
        webApp.handler(req, res);
      }).to.not.throw();
    });

    it("should convert Koa app to handler correctly", () => {
      let callbackCalled = false;
      const koaApp: FrameworkApp = {
        callback: () => {
          return (req: any, res: any) => {
            callbackCalled = true;
            res.writeHead(200);
            res.end("Koa");
          };
        },
      };

      const webApp = new WebApp("koaApp", koaApp, { mountPath: "/koa-test" });

      // Create mock request/response
      const req = {} as http.IncomingMessage;
      const res = {
        writeHead: () => {},
        end: () => {},
      } as any;

      webApp.handler(req, res);
      expect(callbackCalled).to.be.true;
    });

    it("should convert Fastify app to handler correctly", async () => {
      let routingCalled = false;
      const fastifyApp: FrameworkApp = {
        routing: (req: any, res: any) => {
          routingCalled = true;
          res.writeHead(200);
          res.end("Fastify");
        },
      };

      const webApp = new WebApp("fastifyApp", fastifyApp, {
        mountPath: "/fastify-test",
      });

      // Create mock request/response
      const req = {} as http.IncomingMessage;
      const res = {
        writeHead: () => {},
        end: () => {},
      } as any;

      await webApp.handler(req, res);
      expect(routingCalled).to.be.true;
    });

    it("should wait for Fastify ready() before calling routing()", async () => {
      let readyCalled = false;
      let routingCalled = false;
      let readyResolve: () => void;

      const fastifyApp: FrameworkApp = {
        routing: (req: any, res: any) => {
          // Verify ready was called before routing
          expect(readyCalled).to.be.true;
          routingCalled = true;
          res.writeHead(200);
          res.end("Fastify");
        },
        ready: () => {
          return new Promise<void>((resolve) => {
            readyResolve = () => {
              readyCalled = true;
              resolve();
            };
            // Simulate async ready - resolve after a short delay
            setTimeout(readyResolve, 10);
          });
        },
      };

      const webApp = new WebApp("fastifyReadyApp", fastifyApp, {
        mountPath: "/fastify-ready-test",
      });

      const req = {} as http.IncomingMessage;
      const res = {
        writeHead: () => {},
        end: () => {},
      } as any;

      // Handler should wait for ready() to complete
      await webApp.handler(req, res);
      expect(readyCalled).to.be.true;
      expect(routingCalled).to.be.true;
    });

    it("should handle Fastify app without ready() method", async () => {
      let routingCalled = false;
      const fastifyApp: FrameworkApp = {
        routing: (req: any, res: any) => {
          routingCalled = true;
          res.writeHead(200);
          res.end("Fastify");
        },
        // No ready() method
      };

      const webApp = new WebApp("fastifyNoReadyApp", fastifyApp, {
        mountPath: "/fastify-no-ready-test",
      });

      const req = {} as http.IncomingMessage;
      const res = {
        writeHead: () => {},
        end: () => {},
      } as any;

      await webApp.handler(req, res);
      expect(routingCalled).to.be.true;
    });

    it("should convert raw handler correctly", () => {
      let handlerCalled = false;
      const handler: WebAppHandler = (req, res) => {
        handlerCalled = true;
        res.end("Raw handler");
      };

      const webApp = new WebApp("rawApp", handler, { mountPath: "/raw-test" });

      const req = {} as http.IncomingMessage;
      const res = {
        end: () => {},
      } as any;

      webApp.handler(req, res);
      expect(handlerCalled).to.be.true;
    });

    it("should throw error for unsupported app types", () => {
      const unsupportedApp = {
        someMethod: () => {},
      } as any;

      expect(() => {
        new WebApp("unsupportedApp", unsupportedApp, {
          mountPath: "/unsupported",
        });
      }).to.throw("Unable to convert app to handler");
    });

    it("should throw error for app with non-function routing property", () => {
      const invalidApp = {
        routing: {
          // routing should be a function, not an object
          someProperty: "value",
        },
      } as any;

      // Should throw because routing is not a function
      expect(() => {
        new WebApp("invalidApp", invalidApp, {
          mountPath: "/invalid-routing",
        });
      }).to.throw("Unable to convert app to handler");
    });
  });

  describe("Edge Cases", () => {
    it("should verify getRawApp() returns original app reference", () => {
      const expressApp: FrameworkApp = {
        handle: (req: any, res: any) => {},
      };

      const webApp = new WebApp("expressApp", expressApp, {
        mountPath: "/edge-express",
      });

      expect(webApp.getRawApp()).to.equal(expressApp);
    });

    it("should return undefined from getRawApp() for raw handlers", () => {
      const handler: WebAppHandler = (req, res) => {
        res.end("OK");
      };

      const webApp = new WebApp("rawHandler", handler, {
        mountPath: "/edge-raw",
      });

      expect(webApp.getRawApp()).to.be.undefined;
    });

    it("should handle async handlers", async () => {
      let asyncCompleted = false;
      const asyncHandler: WebAppHandler = async (req, res) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        asyncCompleted = true;
        res.end("Async");
      };

      const webApp = new WebApp("asyncApp", asyncHandler, {
        mountPath: "/async-test",
      });

      const req = {} as http.IncomingMessage;
      const res = {
        end: () => {},
      } as any;

      await webApp.handler(req, res);
      expect(asyncCompleted).to.be.true;
    });

    it("should handle Express app with error and headers already sent", () => {
      const expressApp: FrameworkApp = {
        handle: (req: any, res: any, next?: any) => {
          res.headersSent = true;
          if (next) {
            next(new Error("Error after headers sent"));
          }
        },
      };

      const webApp = new WebApp("expressApp", expressApp, {
        mountPath: "/express-headers",
      });

      const req = {} as http.IncomingMessage;
      const res = {
        writeHead: () => {},
        end: () => {},
        headersSent: true,
      } as any;

      // Should not throw even with error after headers sent
      expect(() => {
        webApp.handler(req, res);
      }).to.not.throw();
    });
  });

  describe("Integration with moose internal", () => {
    it("should be retrievable from moose internal by name", () => {
      const webApp = new WebApp("retrievableApp", () => {}, {
        mountPath: "/test",
        metadata: { description: "Test" },
      });

      const internal = getMooseInternal();
      const retrieved = internal.webApps.get("retrievableApp");

      expect(retrieved).to.equal(webApp);
      expect(retrieved?.config.mountPath).to.equal("/test");
      expect(retrieved?.config.metadata?.description).to.equal("Test");
    });

    it("should maintain proper state in moose internal with multiple operations", () => {
      const app1 = new WebApp("app1", () => {}, { mountPath: "/path1" });
      const app2 = new WebApp("app2", () => {}, { mountPath: "/path2" });

      const internal = getMooseInternal();
      expect(internal.webApps.size).to.equal(2);

      // Clear and verify
      internal.webApps.clear();
      expect(internal.webApps.size).to.equal(0);

      // Create new ones after clearing
      const app3 = new WebApp("app3", () => {}, { mountPath: "/path3" });
      expect(internal.webApps.size).to.equal(1);
      expect(internal.webApps.get("app3")).to.equal(app3);
    });
  });
});
