import { expect } from "chai";
import {
  formatVersionSuffix,
  topicNameToStreamName,
  validateTopicConfig,
  TopicConfig,
} from "../src/streaming-functions/runner";

describe("Streaming Function Runner", () => {
  describe("formatVersionSuffix", () => {
    it("should format version string with underscores", () => {
      expect(formatVersionSuffix("1.0")).to.equal("_1_0");
      expect(formatVersionSuffix("1.2.3")).to.equal("_1_2_3");
      expect(formatVersionSuffix("2.0.0")).to.equal("_2_0_0");
    });

    it("should handle single version number", () => {
      expect(formatVersionSuffix("1")).to.equal("_1");
    });
  });

  describe("topicNameToStreamName", () => {
    it("should return name unchanged when no namespace or version", () => {
      const config: TopicConfig = {
        name: "MyStream",
        partitions: 3,
        retention_ms: 86400000,
        max_message_bytes: 1048576,
      };

      expect(topicNameToStreamName(config)).to.equal("MyStream");
    });

    it("should strip version suffix when version is provided", () => {
      const config: TopicConfig = {
        name: "MyStream_1_0",
        partitions: 3,
        retention_ms: 86400000,
        max_message_bytes: 1048576,
        version: "1.0",
      };

      expect(topicNameToStreamName(config)).to.equal("MyStream");
    });

    it("should strip namespace prefix when namespace is provided", () => {
      const config: TopicConfig = {
        name: "prod.MyStream",
        partitions: 3,
        retention_ms: 86400000,
        max_message_bytes: 1048576,
        namespace: "prod",
      };

      expect(topicNameToStreamName(config)).to.equal("MyStream");
    });

    it("should strip both namespace and version when both provided", () => {
      const config: TopicConfig = {
        name: "prod.MyStream_1_0",
        partitions: 3,
        retention_ms: 86400000,
        max_message_bytes: 1048576,
        namespace: "prod",
        version: "1.0",
      };

      expect(topicNameToStreamName(config)).to.equal("MyStream");
    });

    it("should throw error when version suffix not found", () => {
      const config: TopicConfig = {
        name: "MyStream",
        partitions: 3,
        retention_ms: 86400000,
        max_message_bytes: 1048576,
        version: "1.0", // Version specified but not in name
      };

      expect(() => topicNameToStreamName(config)).to.throw(
        "Version suffix _1_0 not found in topic name MyStream",
      );
    });

    it("should throw error when namespace prefix not found", () => {
      const config: TopicConfig = {
        name: "MyStream",
        partitions: 3,
        retention_ms: 86400000,
        max_message_bytes: 1048576,
        namespace: "prod", // Namespace specified but not in name
      };

      expect(() => topicNameToStreamName(config)).to.throw(
        "Namespace prefix prod. not found in topic name MyStream",
      );
    });
  });

  describe("validateTopicConfig", () => {
    it("should pass validation for config without namespace or version", () => {
      const config: TopicConfig = {
        name: "MyStream",
        partitions: 3,
        retention_ms: 86400000,
        max_message_bytes: 1048576,
      };

      expect(() => validateTopicConfig(config)).to.not.throw();
    });

    it("should pass validation when name starts with namespace", () => {
      const config: TopicConfig = {
        name: "prod.MyStream",
        partitions: 3,
        retention_ms: 86400000,
        max_message_bytes: 1048576,
        namespace: "prod",
      };

      expect(() => validateTopicConfig(config)).to.not.throw();
    });

    it("should pass validation when name ends with version suffix", () => {
      const config: TopicConfig = {
        name: "MyStream_1_0",
        partitions: 3,
        retention_ms: 86400000,
        max_message_bytes: 1048576,
        version: "1.0",
      };

      expect(() => validateTopicConfig(config)).to.not.throw();
    });

    it("should throw when namespace specified but name doesn't match", () => {
      const config: TopicConfig = {
        name: "MyStream",
        partitions: 3,
        retention_ms: 86400000,
        max_message_bytes: 1048576,
        namespace: "prod",
      };

      expect(() => validateTopicConfig(config)).to.throw(
        "Topic name MyStream must start with namespace prod",
      );
    });

    it("should throw when version specified but name doesn't match", () => {
      const config: TopicConfig = {
        name: "MyStream",
        partitions: 3,
        retention_ms: 86400000,
        max_message_bytes: 1048576,
        version: "1.0",
      };

      expect(() => validateTopicConfig(config)).to.throw(
        "Topic name MyStream must end with version 1.0",
      );
    });
  });

  describe("TopicConfig interface", () => {
    it("should require max_message_bytes for producer sync", () => {
      const config: TopicConfig = {
        name: "MyStream",
        partitions: 3,
        retention_ms: 86400000,
        max_message_bytes: 1048576, // 1MB - this syncs with producer config
      };

      expect(config.max_message_bytes).to.equal(1048576);
    });

    it("should support various max_message_bytes values", () => {
      const configs: TopicConfig[] = [
        {
          name: "SmallMessages",
          partitions: 1,
          retention_ms: 86400000,
          max_message_bytes: 512 * 1024, // 512KB
        },
        {
          name: "LargeMessages",
          partitions: 1,
          retention_ms: 86400000,
          max_message_bytes: 10 * 1024 * 1024, // 10MB
        },
      ];

      expect(configs[0].max_message_bytes).to.equal(512 * 1024);
      expect(configs[1].max_message_bytes).to.equal(10 * 1024 * 1024);
    });
  });
});
