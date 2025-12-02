import { IJsonSchemaCollection } from "typia";
import { TypedBase } from "../typedBase";
import { Column } from "../../dataModels/dataModelTypes";
import { getMooseInternal } from "../internal";
import { DeadLetterQueue, Stream } from "./stream";

/**
 * @template T The data type of the messages expected by the destination stream.
 */
export interface IngestConfig<T> {
  /**
   * The destination stream where the ingested data should be sent.
   */
  destination: Stream<T>;

  deadLetterQueue?: DeadLetterQueue<T>;
  /**
   * An optional version string for this configuration.
   */
  version?: string;
  /**
   * An optional custom path for the ingestion endpoint.
   */
  path?: string;
  metadata?: { description?: string };
}

/**
 * Represents an Ingest API endpoint, used for sending data into a Moose system, typically writing to a Stream.
 * Provides a typed interface for the expected data format.
 *
 * @template T The data type of the records that this API endpoint accepts. The structure of T defines the expected request body schema.
 */
export class IngestApi<T> extends TypedBase<T, IngestConfig<T>> {
  /**
   * Creates a new IngestApi instance.
   * @param name The name of the ingest API endpoint.
   * @param config Optional configuration for the ingest API.
   */
  constructor(name: string, config?: IngestConfig<T>);

  /**
   * @internal
   * Note: `validators` parameter is a positional placeholder (always undefined for IngestApi).
   * It exists because TypedBase has validators as the 5th param, and we need to pass
   * allowExtraFields as the 6th param. IngestApi doesn't use validators.
   */
  constructor(
    name: string,
    config: IngestConfig<T>,
    schema: IJsonSchemaCollection.IV3_1,
    columns: Column[],
    validators: undefined,
    allowExtraFields: boolean,
  );

  constructor(
    name: string,
    config: IngestConfig<T>,
    schema?: IJsonSchemaCollection.IV3_1,
    columns?: Column[],
    validators?: undefined,
    allowExtraFields?: boolean,
  ) {
    super(name, config, schema, columns, undefined, allowExtraFields);
    const ingestApis = getMooseInternal().ingestApis;
    if (ingestApis.has(name)) {
      throw new Error(`Ingest API with name ${name} already exists`);
    }
    ingestApis.set(name, this);
  }
}
