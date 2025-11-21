import { expect } from "chai";
import { constantTimeCompare } from "../src/consumption-apis/webAppHelpers";

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
});
