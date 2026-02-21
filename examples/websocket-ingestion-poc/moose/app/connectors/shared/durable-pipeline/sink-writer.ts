import {
  SinkDestination,
  StreamSink,
  TableSink,
  TransformedRecord,
} from "./types";

function isTableSink(destination: SinkDestination): destination is TableSink {
  return (
    typeof (destination as TableSink).insert === "function" &&
    typeof (destination as TableSink).assertValidRecord === "function"
  );
}

function isStreamSink(destination: SinkDestination): destination is StreamSink {
  return typeof (destination as StreamSink).send === "function";
}

function assertPlainRecord(value: unknown): TransformedRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Transformed records must be plain objects.");
  }

  return value as TransformedRecord;
}

async function writeToTable(
  resource: string,
  destination: TableSink,
  records: TransformedRecord[],
): Promise<void> {
  const validatedRecords = records.map((record) =>
    destination.assertValidRecord(assertPlainRecord(record)),
  );

  try {
    await destination.insert(validatedRecords as any[]);
  } catch (error) {
    throw new Error(
      `Failed inserting records into table sink for resource '${resource}': ${String(error)}`,
    );
  }
}

async function writeToStream(
  resource: string,
  destination: StreamSink,
  records: TransformedRecord[],
): Promise<void> {
  for (const record of records) {
    try {
      await destination.send(assertPlainRecord(record));
    } catch (error) {
      throw new Error(
        `Failed sending record to stream sink for resource '${resource}': ${String(error)}`,
      );
    }
  }
}

export async function writeRecordsToDestination(
  resource: string,
  destination: SinkDestination,
  records: TransformedRecord[],
): Promise<void> {
  if (records.length === 0) {
    return;
  }

  if (isTableSink(destination)) {
    await writeToTable(resource, destination, records);
    return;
  }

  if (isStreamSink(destination)) {
    await writeToStream(resource, destination, records);
    return;
  }

  throw new Error(
    `Sink for resource '${resource}' is not a supported Stream or OlapTable.`,
  );
}
