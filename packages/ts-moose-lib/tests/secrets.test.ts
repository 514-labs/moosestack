import { expect } from "chai";
import { mooseRuntimeEnv, MOOSE_RUNTIME_ENV_PREFIX } from "../src/secrets";

describe("mooseRuntimeEnv Utility", function () {
  // Set IS_LOADING_INFRA_MAP=true for these tests so mooseRuntimeEnv.get() returns markers
  before(function () {
    process.env.IS_LOADING_INFRA_MAP = "true";
  });

  after(function () {
    delete process.env.IS_LOADING_INFRA_MAP;
  });

  describe("mooseRuntimeEnv.get", () => {
    it("should create a marker string with the correct prefix", () => {
      const varName = "AWS_ACCESS_KEY_ID";
      const result = mooseRuntimeEnv.get(varName);

      expect(result).to.equal(`${MOOSE_RUNTIME_ENV_PREFIX}${varName}`);
      expect(result).to.equal("__MOOSE_RUNTIME_ENV__:AWS_ACCESS_KEY_ID");
    });

    it("should handle different environment variable names", () => {
      const testCases = [
        "AWS_SECRET_ACCESS_KEY",
        "DATABASE_PASSWORD",
        "API_KEY",
        "MY_CUSTOM_SECRET",
      ];

      testCases.forEach((varName) => {
        const result = mooseRuntimeEnv.get(varName);
        expect(result).to.equal(`${MOOSE_RUNTIME_ENV_PREFIX}${varName}`);
        expect(result).to.include(varName);
      });
    });

    it("should throw an error for empty string", () => {
      expect(() => mooseRuntimeEnv.get("")).to.throw(
        "Environment variable name cannot be empty",
      );
    });

    it("should throw an error for whitespace-only string", () => {
      expect(() => mooseRuntimeEnv.get("   ")).to.throw(
        "Environment variable name cannot be empty",
      );
    });

    it("should throw an error for string with only tabs", () => {
      expect(() => mooseRuntimeEnv.get("\t\t")).to.throw(
        "Environment variable name cannot be empty",
      );
    });

    it("should allow variable names with underscores", () => {
      const varName = "MY_LONG_VAR_NAME";
      const result = mooseRuntimeEnv.get(varName);

      expect(result).to.equal(`${MOOSE_RUNTIME_ENV_PREFIX}${varName}`);
    });

    it("should allow variable names with numbers", () => {
      const varName = "API_KEY_123";
      const result = mooseRuntimeEnv.get(varName);

      expect(result).to.equal(`${MOOSE_RUNTIME_ENV_PREFIX}${varName}`);
    });

    it("should preserve exact variable name casing", () => {
      const varName = "MixedCase_VarName";
      const result = mooseRuntimeEnv.get(varName);

      expect(result).to.include(varName);
      expect(result).to.not.include(varName.toLowerCase());
    });

    it("should create markers that can be used in S3Queue configuration", () => {
      const accessKeyMarker = mooseRuntimeEnv.get("AWS_ACCESS_KEY_ID");
      const secretKeyMarker = mooseRuntimeEnv.get("AWS_SECRET_ACCESS_KEY");

      const config = {
        awsAccessKeyId: accessKeyMarker,
        awsSecretAccessKey: secretKeyMarker,
      };

      expect(config.awsAccessKeyId).to.include("AWS_ACCESS_KEY_ID");
      expect(config.awsSecretAccessKey).to.include("AWS_SECRET_ACCESS_KEY");
    });
  });

  describe("MOOSE_RUNTIME_ENV_PREFIX constant", () => {
    it("should have the expected value", () => {
      expect(MOOSE_RUNTIME_ENV_PREFIX).to.equal("__MOOSE_RUNTIME_ENV__:");
    });

    it("should be a string", () => {
      expect(MOOSE_RUNTIME_ENV_PREFIX).to.be.a("string");
    });

    it("should not be empty", () => {
      expect(MOOSE_RUNTIME_ENV_PREFIX.length).to.be.greaterThan(0);
    });
  });

  describe("marker format validation", () => {
    it("should create markers that are easily detectable", () => {
      const marker = mooseRuntimeEnv.get("TEST_VAR");

      expect(marker).to.match(/^__MOOSE_RUNTIME_ENV__:/);
    });

    it("should create markers that can be split to extract variable name", () => {
      const varName = "MY_SECRET";
      const marker = mooseRuntimeEnv.get(varName);

      const parts = marker.split(MOOSE_RUNTIME_ENV_PREFIX);
      expect(parts).to.have.lengthOf(2);
      expect(parts[1]).to.equal(varName);
    });

    it("should create JSON-serializable markers", () => {
      const marker = mooseRuntimeEnv.get("TEST_VAR");
      const json = JSON.stringify({ secret: marker });
      const parsed = JSON.parse(json);

      expect(parsed.secret).to.equal(marker);
    });
  });
});
