import { expect } from "chai";
import {
  constantTimeCompare,
  validateAuthToken,
  getValidApiKeys,
  expressApiKeyAuthMiddleware,
} from "../src/consumption-apis/webAppHelpers";

describe("Express API Key Authentication", function () {
  describe("constantTimeCompare", () => {
    it("should return true for identical strings", () => {
      const result = constantTimeCompare("hello", "hello");
      expect(result).to.be.true;
    });

    it("should return false for different strings of same length", () => {
      const result = constantTimeCompare("hello", "world");
      expect(result).to.be.false;
    });

    it("should return false for strings of different lengths", () => {
      const result = constantTimeCompare("hello", "helloworld");
      expect(result).to.be.false;
    });

    it("should return true for identical hex-encoded hashes", () => {
      const hash = "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3";
      const result = constantTimeCompare(hash, hash);
      expect(result).to.be.true;
    });

    it("should return false for different hex-encoded hashes", () => {
      const hash1 = "a94a8fe5ccb19ba61c4c0873d391e987982fbbd3";
      const hash2 = "b94a8fe5ccb19ba61c4c0873d391e987982fbbd4";
      const result = constantTimeCompare(hash1, hash2);
      expect(result).to.be.false;
    });

    it("should handle empty strings", () => {
      const result = constantTimeCompare("", "");
      expect(result).to.be.true;
    });
  });

  describe("validateAuthToken", () => {
    // Test vector: token "testtoken123", salt "testsalt456"
    // Generated with: pbkdf2_hmac_sha256("testtoken123", "testsalt456", 1000, 20)
    const validToken = "testtoken123.testsalt456";
    const validHash = "16f1007b989903c142e7a8165e669cb737a4aee4";

    it("should return true for valid token and hash", () => {
      const result = validateAuthToken(validToken, validHash);
      expect(result).to.be.true;
    });

    it("should return false for token with wrong token part", () => {
      const result = validateAuthToken("wrong.testsalt456", validHash);
      expect(result).to.be.false;
    });

    it("should return false for token with wrong salt part", () => {
      const result = validateAuthToken("testtoken123.wrong", validHash);
      expect(result).to.be.false;
    });

    it("should return false for malformed token (no dot separator)", () => {
      const result = validateAuthToken("testtoken123testsalt456", validHash);
      expect(result).to.be.false;
    });

    it("should return false for token with multiple dots", () => {
      const result = validateAuthToken("test.token.salt", validHash);
      expect(result).to.be.false;
    });

    it("should return false for empty token", () => {
      const result = validateAuthToken("", validHash);
      expect(result).to.be.false;
    });

    it("should return false for token with empty parts", () => {
      const result = validateAuthToken(".testsalt456", validHash);
      expect(result).to.be.false;
    });
  });

  describe("getValidApiKeys", () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
      // Save original env var
      originalEnv = process.env.MOOSE_WEB_APP_API_KEYS;
    });

    afterEach(() => {
      // Restore original env var
      if (originalEnv === undefined) {
        delete process.env.MOOSE_WEB_APP_API_KEYS;
      } else {
        process.env.MOOSE_WEB_APP_API_KEYS = originalEnv;
      }
    });

    it("should return false when env var is not set", () => {
      delete process.env.MOOSE_WEB_APP_API_KEYS;
      const result = getValidApiKeys();
      expect(result).to.be.false;
    });

    it("should return false when env var is empty string", () => {
      process.env.MOOSE_WEB_APP_API_KEYS = "";
      const result = getValidApiKeys();
      expect(result).to.be.false;
    });

    it("should return single key when one key is provided", () => {
      process.env.MOOSE_WEB_APP_API_KEYS = "hash123";
      const result = getValidApiKeys();
      expect(result).to.deep.equal(["hash123"]);
    });

    it("should return multiple keys when comma-separated", () => {
      process.env.MOOSE_WEB_APP_API_KEYS = "hash1,hash2,hash3";
      const result = getValidApiKeys();
      expect(result).to.be.an("array");
      expect(result).to.have.lengthOf(3);
      expect(result).to.deep.equal(["hash1", "hash2", "hash3"]);
    });

    it("should trim whitespace from keys", () => {
      process.env.MOOSE_WEB_APP_API_KEYS = " hash1 , hash2 , hash3 ";
      const result = getValidApiKeys();
      expect(result).to.deep.equal(["hash1", "hash2", "hash3"]);
    });

    it("should filter out empty keys", () => {
      process.env.MOOSE_WEB_APP_API_KEYS = "hash1,,hash2,  ,hash3";
      const result = getValidApiKeys();
      expect(result).to.deep.equal(["hash1", "hash2", "hash3"]);
    });

    it("should return false when all keys are empty after filtering", () => {
      process.env.MOOSE_WEB_APP_API_KEYS = " , , ";
      const result = getValidApiKeys();
      expect(result).to.be.false;
    });

    it("should accept keys with minimum length (32 chars)", () => {
      const longKey = "a".repeat(32);
      process.env.MOOSE_WEB_APP_API_KEYS = longKey;
      const result = getValidApiKeys();
      expect(result).to.deep.equal([longKey]);
    });

    it("should accept keys shorter than 32 chars (with warning)", () => {
      // Note: This tests that short keys are accepted, not that warning is logged
      const shortKey = "short";
      process.env.MOOSE_WEB_APP_API_KEYS = shortKey;
      const result = getValidApiKeys();
      expect(result).to.deep.equal([shortKey]);
    });
  });

  describe("expressApiKeyAuthMiddleware", () => {
    let originalEnv: string | undefined;

    beforeEach(() => {
      originalEnv = process.env.MOOSE_WEB_APP_API_KEYS;
    });

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.MOOSE_WEB_APP_API_KEYS;
      } else {
        process.env.MOOSE_WEB_APP_API_KEYS = originalEnv;
      }
    });

    describe("when API keys are not configured", () => {
      it("should call next() and allow request through", () => {
        delete process.env.MOOSE_WEB_APP_API_KEYS;

        const middleware = expressApiKeyAuthMiddleware();
        const req = { headers: {} };
        const res: any = {
          status: function (code: number) {
            this.statusCode = code;
            return this;
          },
          json: function (data: any) {
            this.body = data;
            return this;
          },
        };
        let nextCalled = false;
        const next = () => {
          nextCalled = true;
        };

        middleware(req, res, next);

        expect(nextCalled).to.be.true;
      });
    });

    describe("when API keys are configured", () => {
      // Generate a valid test token using Node.js crypto
      const testToken = "testtoken123";
      const testSalt = "testsalt456";
      let validHash: string;
      let validBearerToken: string;

      before(() => {
        const crypto = require("crypto");
        const key = crypto.pbkdf2Sync(testToken, testSalt, 1000, 20, "sha256");
        validHash = key.toString("hex");
        validBearerToken = `${testToken}.${testSalt}`;
      });

      it("should return 401 when Authorization header is missing", () => {
        process.env.MOOSE_WEB_APP_API_KEYS = validHash;

        const middleware = expressApiKeyAuthMiddleware();
        const req = { headers: {} };
        const res: any = {
          statusCode: 0,
          body: null,
          status: function (code: number) {
            this.statusCode = code;
            return this;
          },
          json: function (data: any) {
            this.body = data;
            return this;
          },
        };
        let nextCalled = false;
        const next = () => {
          nextCalled = true;
        };

        middleware(req, res, next);

        expect(nextCalled).to.be.false;
        expect(res.statusCode).to.equal(401);
        expect(res.body).to.deep.equal({ error: "Unauthorized" });
      });

      it("should return 401 when Authorization header format is invalid (no Bearer)", () => {
        process.env.MOOSE_WEB_APP_API_KEYS = validHash;

        const middleware = expressApiKeyAuthMiddleware();
        const req = { headers: { authorization: validBearerToken } };
        const res: any = {
          statusCode: 0,
          body: null,
          status: function (code: number) {
            this.statusCode = code;
            return this;
          },
          json: function (data: any) {
            this.body = data;
            return this;
          },
        };
        let nextCalled = false;
        const next = () => {
          nextCalled = true;
        };

        middleware(req, res, next);

        expect(nextCalled).to.be.false;
        expect(res.statusCode).to.equal(401);
      });

      it("should return 401 when token is invalid", () => {
        process.env.MOOSE_WEB_APP_API_KEYS = validHash;

        const middleware = expressApiKeyAuthMiddleware();
        const req = { headers: { authorization: "Bearer invalid.token" } };
        const res: any = {
          statusCode: 0,
          body: null,
          status: function (code: number) {
            this.statusCode = code;
            return this;
          },
          json: function (data: any) {
            this.body = data;
            return this;
          },
        };
        let nextCalled = false;
        const next = () => {
          nextCalled = true;
        };

        middleware(req, res, next);

        expect(nextCalled).to.be.false;
        expect(res.statusCode).to.equal(401);
      });

      it("should call next() when token is valid", () => {
        process.env.MOOSE_WEB_APP_API_KEYS = validHash;

        const middleware = expressApiKeyAuthMiddleware();
        const req = {
          headers: { authorization: `Bearer ${validBearerToken}` },
        };
        const res: any = {
          status: function (code: number) {
            this.statusCode = code;
            return this;
          },
          json: function (data: any) {
            this.body = data;
            return this;
          },
        };
        let nextCalled = false;
        const next = () => {
          nextCalled = true;
        };

        middleware(req, res, next);

        expect(nextCalled).to.be.true;
      });

      it("should accept any valid key when multiple keys are configured", () => {
        const crypto = require("crypto");
        const token2 = "token2";
        const salt2 = "salt2";
        const key2 = crypto.pbkdf2Sync(token2, salt2, 1000, 20, "sha256");
        const hash2 = key2.toString("hex");

        process.env.MOOSE_WEB_APP_API_KEYS = `${validHash},${hash2}`;

        const middleware = expressApiKeyAuthMiddleware();
        const req = {
          headers: { authorization: `Bearer ${token2}.${salt2}` },
        };
        const res: any = {
          status: function (code: number) {
            this.statusCode = code;
            return this;
          },
          json: function (data: any) {
            this.body = data;
            return this;
          },
        };
        let nextCalled = false;
        const next = () => {
          nextCalled = true;
        };

        middleware(req, res, next);

        expect(nextCalled).to.be.true;
      });
    });
  });
});
