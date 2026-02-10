import {
  SinkDestination,
  StreamDestination,
  TableDestination,
  TransformedRecord,
} from "./types";

function isTableDestination(
  destination: SinkDestination,
): destination is TableDestination {
  return (
    typeof (destination as TableDestination).insert === "function" &&
    typeof (destination as TableDestination).assertValidRecord === "function"
  );
}

function isStreamDestination(
  destination: SinkDestination,
): destination is StreamDestination {
  return typeof (destination as StreamDestination).send === "function";
}

function assertPlainRecord(value: unknown): TransformedRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Transformed records must be plain objects.");
  }

  return value as TransformedRecord;
}

async function writeToTable(
  resource: string,
  destination: TableDestination,
  records: TransformedRecord[],
): Promise<void> {
  const validatedRecords = records.map((record) =>
    destination.assertValidRecord(assertPlainRecord(record)),
  );

  try {
    await destination.insert(validatedRecords as any[]);
  } catch (error) {
    throw new Error(
      `Failed inserting records into table destination for resource '${resource}': ${String(error)}`,
    );
  }
}

async function writeToStream(
  resource: string,
  destination: StreamDestination,
  records: TransformedRecord[],
): Promise<void> {
  for (const record of records) {
    try {
      await destination.send(assertPlainRecord(record));
    } catch (error) {
      throw new Error(
        `Failed sending record to stream destination for resource '${resource}': ${String(error)}`,
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

  if (isTableDestination(destination)) {
    await writeToTable(resource, destination, records);
    return;
  }

  if (isStreamDestination(destination)) {
    await writeToStream(resource, destination, records);
    return;
  }

  throw new Error(
    `Destination for resource '${resource}' is not a supported Stream or OlapTable.`,
  );
}
