import { expect } from "chai";
import {
  constantTimeCompare,
  validateAuthToken,
  getValidApiKeys,
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
      expect(result).to.be.an("array");
      expect(result).to.have.lengthOf(1);
      expect(result![0]).to.equal("hash123");
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
      expect(result).to.be.an("array");
      expect(result).to.have.lengthOf(1);
    });

    it("should accept keys shorter than 32 chars (with warning)", () => {
      // Note: This tests that short keys are accepted, not that warning is logged
      const shortKey = "short";
      process.env.MOOSE_WEB_APP_API_KEYS = shortKey;
      const result = getValidApiKeys();
      expect(result).to.be.an("array");
      expect(result).to.have.lengthOf(1);
      expect(result![0]).to.equal(shortKey);
    });
  });
});
