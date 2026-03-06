import KafkaCjs from "@514labs/kafka-javascript";
import type { LibrdKafkaError } from "@514labs/kafka-javascript";
const { Producer, HighLevelProducer } = KafkaCjs;

import { SchemaRegistry, SchemaType } from "@kafkajs/confluent-schema-registry";

async function main() {
  const brokers = process.env.BOOTSTRAP || "localhost:9092";
  const topic = process.env.TOPIC || "test-topic";
  const schemaRegistryUrl =
    process.env.SCHEMA_REGISTRY_URL || "http://localhost:8081";
  const subject = process.env.SCHEMA_SUBJECT || `${topic}-value`;

  const producer = new Producer({
    "metadata.broker.list": brokers,
    "client.id": "kafka-local-producer",
    dr_cb: true,
  });

  const registry = new SchemaRegistry({ host: schemaRegistryUrl });

  producer.setPollInterval(100);

  await new Promise<void>((resolve, reject) => {
    producer
      .on("ready", () => resolve())
      .on("event.error", (err: LibrdKafkaError) => {
        console.error("Kafka error", err);
      })
      .connect();
  });

  // Ensure schema exists and fetch its ID
  // If the subject/schema was pre-registered by compose init, getLatestId is enough
  let schemaId: number;
  try {
    schemaId = await registry.getLatestSchemaId(subject);
  } catch (e) {
    // Fallback: register a default schema if not present
    const schema = {
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "User",
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "integer" },
        name: { type: "string" },
      },
      required: ["id", "name"],
    } as any;
    const { id } = await registry.register(
      { type: SchemaType.JSON, schema: JSON.stringify(schema) },
      { subject },
    );
    schemaId = id;
  }

  console.log(
    `Sending 5 JSON messages to ${topic} (subject ${subject}, schemaId ${schemaId}) at ${brokers}...`,
  );
  for (let i = 0; i < 5; i++) {
    const key = `key-${i}`;
    const value = { id: i, name: `user-${i}` } as Record<string, unknown>;
    const encoded = await registry.encode(schemaId, value);
    producer.produce(topic, null, encoded as Buffer, key);
  }

  await new Promise<void>((resolve, reject) => {
    producer.flush(10000, (err: LibrdKafkaError) => {
      if (err) return reject(err);
      resolve();
    });
  });

  producer.disconnect();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
