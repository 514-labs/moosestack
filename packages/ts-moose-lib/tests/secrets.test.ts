import { expect } from "chai";
import { mooseEnvSecrets, MOOSE_ENV_SECRET_PREFIX } from "../src/secrets";

describe("mooseEnvSecrets Utility", function () {
  describe("mooseEnvSecrets.get", () => {
    it("should create a marker string with the correct prefix", () => {
      const varName = "AWS_ACCESS_KEY_ID";
      const result = mooseEnvSecrets.get(varName);

      expect(result).to.equal(`${MOOSE_ENV_SECRET_PREFIX}${varName}`);
      expect(result).to.equal("__MOOSE_ENV_SECRET__:AWS_ACCESS_KEY_ID");
    });

    it("should handle different environment variable names", () => {
      const testCases = [
        "AWS_SECRET_ACCESS_KEY",
        "DATABASE_PASSWORD",
        "API_KEY",
        "MY_CUSTOM_SECRET",
      ];

      testCases.forEach((varName) => {
        const result = mooseEnvSecrets.get(varName);
        expect(result).to.equal(`${MOOSE_ENV_SECRET_PREFIX}${varName}`);
        expect(result).to.include(varName);
      });
    });

    it("should throw an error for empty string", () => {
      expect(() => mooseEnvSecrets.get("")).to.throw(
        "Environment variable name cannot be empty",
      );
    });

    it("should throw an error for whitespace-only string", () => {
      expect(() => mooseEnvSecrets.get("   ")).to.throw(
        "Environment variable name cannot be empty",
      );
    });

    it("should throw an error for string with only tabs", () => {
      expect(() => mooseEnvSecrets.get("\t\t")).to.throw(
        "Environment variable name cannot be empty",
      );
    });

    it("should allow variable names with underscores", () => {
      const varName = "MY_LONG_VAR_NAME";
      const result = mooseEnvSecrets.get(varName);

      expect(result).to.equal(`${MOOSE_ENV_SECRET_PREFIX}${varName}`);
    });

    it("should allow variable names with numbers", () => {
      const varName = "API_KEY_123";
      const result = mooseEnvSecrets.get(varName);

      expect(result).to.equal(`${MOOSE_ENV_SECRET_PREFIX}${varName}`);
    });

    it("should preserve exact variable name casing", () => {
      const varName = "MixedCase_VarName";
      const result = mooseEnvSecrets.get(varName);

      expect(result).to.include(varName);
      expect(result).to.not.include(varName.toLowerCase());
    });

    it("should create markers that can be used in S3Queue configuration", () => {
      const accessKeyMarker = mooseEnvSecrets.get("AWS_ACCESS_KEY_ID");
      const secretKeyMarker = mooseEnvSecrets.get("AWS_SECRET_ACCESS_KEY");

      const config = {
        awsAccessKeyId: accessKeyMarker,
        awsSecretAccessKey: secretKeyMarker,
      };

      expect(config.awsAccessKeyId).to.include("AWS_ACCESS_KEY_ID");
      expect(config.awsSecretAccessKey).to.include("AWS_SECRET_ACCESS_KEY");
    });
  });

  describe("MOOSE_ENV_SECRET_PREFIX constant", () => {
    it("should have the expected value", () => {
      expect(MOOSE_ENV_SECRET_PREFIX).to.equal("__MOOSE_ENV_SECRET__:");
    });

    it("should be a string", () => {
      expect(MOOSE_ENV_SECRET_PREFIX).to.be.a("string");
    });

    it("should not be empty", () => {
      expect(MOOSE_ENV_SECRET_PREFIX.length).to.be.greaterThan(0);
    });
  });

  describe("marker format validation", () => {
    it("should create markers that are easily detectable", () => {
      const marker = mooseEnvSecrets.get("TEST_VAR");

      expect(marker).to.match(/^__MOOSE_ENV_SECRET__:/);
    });

    it("should create markers that can be split to extract variable name", () => {
      const varName = "MY_SECRET";
      const marker = mooseEnvSecrets.get(varName);

      const parts = marker.split(MOOSE_ENV_SECRET_PREFIX);
      expect(parts).to.have.lengthOf(2);
      expect(parts[1]).to.equal(varName);
    });

    it("should create JSON-serializable markers", () => {
      const marker = mooseEnvSecrets.get("TEST_VAR");
      const json = JSON.stringify({ secret: marker });
      const parsed = JSON.parse(json);

      expect(parsed.secret).to.equal(marker);
    });
  });
});
