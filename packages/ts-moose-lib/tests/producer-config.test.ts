import { expect } from "chai";
import {
  createProducerConfig,
  ACKs,
  MAX_RETRIES_PRODUCER,
  MAX_RETRY_TIME_MS,
} from "../src/commons";

describe("Producer Configuration", () => {
  describe("createProducerConfig", () => {
    it("should create config with idempotent disabled for at-least-once delivery", () => {
      const config = createProducerConfig();

      expect(config.kafkaJS.idempotent).to.equal(false);
    });

    it("should set acks to -1 (all replicas) for durability", () => {
      const config = createProducerConfig();

      expect(config.kafkaJS.acks).to.equal(-1);
      expect(config.kafkaJS.acks).to.equal(ACKs);
    });

    it("should set linger.ms to 0 for immediate send", () => {
      const config = createProducerConfig();

      expect(config["linger.ms"]).to.equal(0);
    });

    it("should include retry configuration", () => {
      const config = createProducerConfig();

      expect(config.kafkaJS.retry).to.deep.equal({
        retries: MAX_RETRIES_PRODUCER,
        maxRetryTime: MAX_RETRY_TIME_MS,
      });
    });

    it("should NOT include message.max.bytes when not provided", () => {
      const config = createProducerConfig();

      expect(config).to.not.have.property("message.max.bytes");
    });

    it("should include message.max.bytes when provided", () => {
      const maxBytes = 2 * 1024 * 1024; // 2MB
      const config = createProducerConfig(maxBytes);

      expect(config["message.max.bytes"]).to.equal(maxBytes);
    });

    it("should sync message.max.bytes with topic config value", () => {
      // Simulate topic config from server
      const topicMaxMessageBytes = 5242880; // 5MB from server
      const config = createProducerConfig(topicMaxMessageBytes);

      expect(config["message.max.bytes"]).to.equal(topicMaxMessageBytes);
    });

    it("should handle zero maxMessageBytes as falsy (not included)", () => {
      const config = createProducerConfig(0);

      // 0 is falsy, so message.max.bytes should NOT be included
      expect(config).to.not.have.property("message.max.bytes");
    });
  });

  describe("Constants", () => {
    it("should have ACKs set to -1 (all replicas)", () => {
      expect(ACKs).to.equal(-1);
    });

    it("should have reasonable retry configuration", () => {
      expect(MAX_RETRIES_PRODUCER).to.be.greaterThan(0);
      expect(MAX_RETRY_TIME_MS).to.be.greaterThan(0);
    });
  });

  describe("At-Least-Once Delivery Guarantee", () => {
    it("should have configuration that ensures at-least-once delivery", () => {
      const config = createProducerConfig();

      // For at-least-once:
      // 1. idempotent: false is OK (only needed for exactly-once)
      // 2. acks: -1 ensures all replicas acknowledge
      // 3. retries > 0 ensures transient failures are retried

      expect(config.kafkaJS.idempotent).to.equal(false);
      expect(config.kafkaJS.acks).to.equal(-1);
      expect(config.kafkaJS.retry.retries).to.be.greaterThan(0);
    });

    it("should NOT use exactly-once settings (idempotent)", () => {
      const config = createProducerConfig();

      // idempotent: true adds overhead and is not needed for at-least-once
      expect(config.kafkaJS.idempotent).to.not.equal(true);
    });
  });
});
