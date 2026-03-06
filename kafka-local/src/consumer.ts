import { KafkaConsumer } from "@514labs/kafka-javascript";
import type { LibrdKafkaError } from "@514labs/kafka-javascript";

import { SchemaRegistry } from "@kafkajs/confluent-schema-registry";

async function main() {
  const brokers = process.env.BOOTSTRAP || "localhost:19092";
  const topic = process.env.TOPIC || "pg_cdc.public.customer_addresses";
  const schemaRegistryUrl = "http://localhost:8081/apis/ccompat/v7/";
  const decode = (process.env.DECODE || "true").toLowerCase() !== "false";

  const consumer = new KafkaConsumer(
    {
      "metadata.broker.list": brokers,
      // group.id is required by KafkaConsumer, but we will NOT use group features.
      // We will manually assign partitions and never commit offsets.
      "group.id": "manual-reader",
      "enable.auto.commit": false,
    },
    {
      // We will explicitly start from beginning using manual assignment
      "auto.offset.reset": "earliest",
    },
  );

  const registry = new SchemaRegistry({ host: schemaRegistryUrl });

  process.on("SIGINT", () => shutdown(consumer));
  process.on("SIGTERM", () => shutdown(consumer));

  const OFFSET_BEGINNING = -2; // librdkafka constant for earliest offset

  await new Promise<void>((resolve, reject) => {
    consumer
      .on("ready", () => {
        console.log(
          `Connected to ${brokers}. Assigning '${topic}' from beginning...`,
        );
        // Discover partitions, then manually assign from beginning for each
        consumer.getMetadata(
          { topic, timeout: 10000 },
          (err: unknown, md: any) => {
            if (err) {
              console.error("Metadata error", err);
              reject(err as Error);
              return;
            }

            const topicMeta =
              md?.topics?.find((t: any) => t?.name === topic) ??
              md?.topics?.[0];
            const partitions: number[] = (topicMeta?.partitions ?? [])
              .map((p: any) => p?.id)
              .filter((p: any) => typeof p === "number");
            if (!partitions.length) {
              console.warn(
                `No partitions found for topic '${topic}'. Assigning partition 0.`,
              );
            }

            const assignments = (partitions.length ? partitions : [0]).map(
              (p) => ({
                topic,
                partition: p,
                offset: OFFSET_BEGINNING,
              }),
            );

            consumer.assign(assignments as any);
            consumer.consume();
            resolve();
          },
        );
      })
      .on("event.error", (err: LibrdKafkaError) => {
        console.error("Kafka error", err);
      })
      .on("disconnected", (metrics: unknown) => {
        console.log("Disconnected", metrics);
      })
      .connect();
  });

  consumer.on("data", async (message: any) => {
    try {
      const valueBuf: Buffer | null = message.value ?? null;
      const keyBuf: Buffer | null = message.key ?? null;

      let decodedValue: unknown = null;
      if (valueBuf) {
        if (decode) {
          try {
            decodedValue = await registry.decode(valueBuf.subarray(4));
          } catch (e) {
            console.log(e);
            console.log(valueBuf.toString("hex"));
            // // Fallback to UTF-8 if not a Confluent-encoded payload
            // decodedValue = valueBuf.toString("utf8");
          }
        } else {
          decodedValue = valueBuf.toString("utf8");
        }
      }

      const key = keyBuf ? keyBuf.toString("utf8") : null;

      console.log(
        JSON.stringify(
          {
            topic: message.topic,
            partition: message.partition,
            offset: message.offset,
            timestamp: message.timestamp,
            key,
            value: decodedValue,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      console.error("Message handling error", err);
    }
  });
}

function shutdown(consumer: InstanceType<typeof KafkaConsumer>) {
  console.log("Shutting down consumer...");
  try {
    consumer.disconnect();
  } catch (e) {
    // ignore
  } finally {
    // A tiny delay to allow disconnect event
    setTimeout(() => process.exit(0), 100);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
