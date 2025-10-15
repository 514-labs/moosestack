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

      const webApp = new WebApp("testApp", handler);

      expect(webApp.name).to.equal("testApp");
      expect(webApp.handler).to.be.a("function");
      expect(webApp.config).to.deep.equal({});
      expect(webApp.getRawApp()).to.be.undefined;
    });

    it("should create WebApp with Express-like app (handle method)", () => {
      const expressApp: FrameworkApp = {
        handle: (req: any, res: any, next?: any) => {
          res.writeHead(200);
          res.end("Express");
        },
      };

      const webApp = new WebApp("expressApp", expressApp);

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

      const webApp = new WebApp("koaApp", koaApp);

      expect(webApp.name).to.equal("koaApp");
      expect(webApp.handler).to.be.a("function");
      expect(webApp.getRawApp()).to.equal(koaApp);
    });

    it("should create WebApp with Fastify-like app (routing property)", () => {
      const fastifyApp: FrameworkApp = {
        routing: {
          handle: (req: any, res: any) => {
            res.writeHead(200);
            res.end("Fastify");
          },
        },
      };

      const webApp = new WebApp("fastifyApp", fastifyApp);

      expect(webApp.name).to.equal("fastifyApp");
      expect(webApp.handler).to.be.a("function");
      expect(webApp.getRawApp()).to.equal(fastifyApp);
    });

    it("should create WebApp with minimal config (no mountPath)", () => {
      const handler: WebAppHandler = (req, res) => {
        res.end("OK");
      };

      const webApp = new WebApp("minimalApp", handler);

      expect(webApp.config.mountPath).to.be.undefined;
      expect(webApp.config.metadata).to.be.undefined;
      expect(webApp.config.injectMooseUtils).to.be.undefined;
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
      const webApp = new WebApp("registeredApp", () => {});

      const internal = getMooseInternal();
      expect(internal.webApps.has("registeredApp")).to.be.true;
      expect(internal.webApps.get("registeredApp")).to.equal(webApp);
    });

    it("should throw error when creating WebApp with duplicate name", () => {
      new WebApp("duplicateName", () => {});

      expect(() => {
        new WebApp("duplicateName", () => {});
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
      const app3 = new WebApp("app3", () => {}); // No mountPath

      const internal = getMooseInternal();
      expect(internal.webApps.size).to.equal(3);
      expect(internal.webApps.get("app1")).to.equal(app1);
      expect(internal.webApps.get("app2")).to.equal(app2);
      expect(internal.webApps.get("app3")).to.equal(app3);
    });

    it("should allow multiple WebApps without mountPaths", () => {
      const app1 = new WebApp("app1", () => {});
      const app2 = new WebApp("app2", () => {});

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

      const webApp = new WebApp("expressApp", expressApp);

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

      const webApp = new WebApp("expressApp", expressApp);

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

      const webApp = new WebApp("koaApp", koaApp);

      // Create mock request/response
      const req = {} as http.IncomingMessage;
      const res = {
        writeHead: () => {},
        end: () => {},
      } as any;

      webApp.handler(req, res);
      expect(callbackCalled).to.be.true;
    });

    it("should convert Fastify app to handler correctly", () => {
      let routingCalled = false;
      const fastifyApp: FrameworkApp = {
        routing: {
          handle: (req: any, res: any) => {
            routingCalled = true;
            res.writeHead(200);
            res.end("Fastify");
          },
        },
      };

      const webApp = new WebApp("fastifyApp", fastifyApp);

      // Create mock request/response
      const req = {} as http.IncomingMessage;
      const res = {
        writeHead: () => {},
        end: () => {},
      } as any;

      webApp.handler(req, res);
      expect(routingCalled).to.be.true;
    });

    it("should convert raw handler correctly", () => {
      let handlerCalled = false;
      const handler: WebAppHandler = (req, res) => {
        handlerCalled = true;
        res.end("Raw handler");
      };

      const webApp = new WebApp("rawApp", handler);

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
        new WebApp("unsupportedApp", unsupportedApp);
      }).to.throw("Unable to convert app to handler");
    });

    it("should throw error for Fastify app without routing.handle", async () => {
      const invalidFastifyApp = {
        routing: {
          // Missing handle method
          someOtherProperty: "value",
        },
      } as any;

      const webApp = new WebApp("invalidFastify", invalidFastifyApp);

      const req = {} as http.IncomingMessage;
      const res = {} as any;

      // The handler should be created, but calling it should throw
      try {
        await webApp.handler(req, res);
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.be.an("error");
        expect((error as Error).message).to.include(
          "Fastify app detected but not properly initialized",
        );
      }
    });
  });

  describe("Edge Cases", () => {
    it("should verify getRawApp() returns original app reference", () => {
      const expressApp: FrameworkApp = {
        handle: (req: any, res: any) => {},
      };

      const webApp = new WebApp("expressApp", expressApp);

      expect(webApp.getRawApp()).to.equal(expressApp);
    });

    it("should return undefined from getRawApp() for raw handlers", () => {
      const handler: WebAppHandler = (req, res) => {
        res.end("OK");
      };

      const webApp = new WebApp("rawHandler", handler);

      expect(webApp.getRawApp()).to.be.undefined;
    });

    it("should handle async handlers", async () => {
      let asyncCompleted = false;
      const asyncHandler: WebAppHandler = async (req, res) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        asyncCompleted = true;
        res.end("Async");
      };

      const webApp = new WebApp("asyncApp", asyncHandler);

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

      const webApp = new WebApp("expressApp", expressApp);

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
