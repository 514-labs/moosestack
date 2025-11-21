import { expect } from "chai";
import {
  constantTimeCompare,
  validateAuthToken,
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
});
