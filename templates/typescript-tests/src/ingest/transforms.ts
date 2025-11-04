import { FooPipeline, BarPipeline, Foo, Bar, arrayInputStream } from "./models";
import { DeadLetterQueue, MooseCache } from "@514labs/moose-lib";

// Transform Foo events to Bar events
FooPipeline.stream!.addTransform(
  BarPipeline.stream!,
  async (foo: Foo): Promise<Bar> => {
    /**
     * Transform Foo events to Bar events with error handling and caching.
     *
     * Normal flow:
     * 1. Check cache for previously processed events
     * 2. Transform Foo to Bar
     * 3. Cache the result
     * 4. Return transformed Bar event
     *
     * Alternate flow (DLQ):
     * - If errors occur during transformation, the event is sent to DLQ
     * - This enables separate error handling, monitoring, and retry strategies
     */

    // Initialize cache
    const cache = await MooseCache.get();
    const cacheKey = `processed:${foo.primaryKey}`;

    // Check if we have processed this event before
    const cached = await cache.get<Bar>(cacheKey);
    if (cached) {
      console.log(`Using cached result for ${foo.primaryKey}`);
      return cached;
    }

    if (foo.timestamp === 1728000000.0) {
      // magic value to test the dead letter queue
      throw new Error("blah");
    }

    const result: Bar = {
      primaryKey: foo.primaryKey,
      utcTimestamp: new Date(foo.timestamp * 1000),
      hasText: foo.optionalText !== undefined,
      textLength: foo.optionalText?.length ?? 0,
    };

    // Cache the result (1 hour retention)
    await cache.set(cacheKey, result, 3600);

    return result;
  },
  {
    deadLetterQueue: FooPipeline.deadLetterQueue,
  },
);

// Add a streaming consumer to print Foo events
const printFooEvent = (foo: Foo): void => {
  console.log("Received Foo event:");
  console.log(`  Primary Key: ${foo.primaryKey}`);
  console.log(`  Timestamp: ${new Date(foo.timestamp * 1000)}`);
  console.log(`  Optional Text: ${foo.optionalText ?? "None"}`);
  console.log("---");
};

FooPipeline.stream!.addConsumer(printFooEvent);

// DLQ consumer for handling failed events (alternate flow)
FooPipeline.deadLetterQueue!.addConsumer((deadLetter) => {
  console.log(deadLetter);
  const foo: Foo = deadLetter.asTyped();
  console.log(foo);
});

// Test transform that returns an array - each element should be sent as a separate Kafka message
import { arrayOutputStream, ArrayInput, ArrayOutput } from "./models";

arrayInputStream.addTransform(
  arrayOutputStream,
  (input: ArrayInput): ArrayOutput[] => {
    // Explode the input array into individual output records
    // Each item in input.data becomes a separate Kafka message
    return input.data.map((value, index) => ({
      inputId: input.id,
      value: value,
      index: index,
      timestamp: new Date(),
    }));
  },
);

// Test transform that generates large messages to test DLQ for MESSAGE_TOO_LARGE errors
import {
  LargeMessageInputPipeline,
  largeMessageOutputStream,
  LargeMessageInput,
  LargeMessageOutput,
} from "./models";

LargeMessageInputPipeline.stream!.addTransform(
  largeMessageOutputStream,
  (input: LargeMessageInput): LargeMessageOutput => {
    // Generate a string that's approximately 1MB * multiplier
    // This should trigger MESSAGE_TOO_LARGE error if multiplier is high enough
    const oneMB = 1024 * 1024;
    const targetSize = oneMB * input.multiplier;

    // Create a large string by repeating a pattern
    const pattern = "0123456789ABCDEF"; // 16 bytes
    const repetitions = Math.floor(targetSize / pattern.length);
    const largeData = pattern.repeat(repetitions);

    return {
      id: input.id,
      timestamp: new Date(),
      largeData: largeData,
    };
  },
  {
    deadLetterQueue: LargeMessageInputPipeline.deadLetterQueue,
  },
);
