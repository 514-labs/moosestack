import { IJsonSchemaCollection } from "typia/src/schemas/json/IJsonSchemaCollection";
import { Column } from "../dataModels/dataModelTypes";
import { getSourceFileInfo } from "./utils/stackTrace";

/**
 * Type definition for typia validation functions
 */
export interface TypiaValidators<T> {
  /** Typia validator function: returns { success: boolean, data?: T, errors?: any[] } */
  validate?: (data: unknown) => { success: boolean; data?: T; errors?: any[] };
  /** Typia assert function: throws on validation failure, returns T on success */
  assert?: (data: unknown) => T;
  /** Typia is function: returns boolean indicating if data matches type T */
  is?: (data: unknown) => data is T;
}

/**
 * Base class for all typed Moose dmv2 resources (OlapTable, Stream, etc.).
 * Handles the storage and injection of schema information (JSON schema and Column array)
 * provided by the Moose compiler plugin.
 *
 * @template T The data type (interface or type alias) defining the schema of the resource.
 * @template C The specific configuration type for the resource (e.g., OlapConfig, StreamConfig).
 */
export class TypedBase<T, C> {
  /** The JSON schema representation of type T. Injected by the compiler plugin. */
  schema: IJsonSchemaCollection.IV3_1;
  /** The name assigned to this resource instance. */
  name: string;

  /** A dictionary mapping column names (keys of T) to their Column definitions. */
  columns: {
    [columnName in keyof Required<T>]: Column;
  };
  /** An array containing the Column definitions for this resource. Injected by the compiler plugin. */
  columnArray: Column[];

  /** The configuration object specific to this resource type. */
  config: C;

  /** Typia validation functions for type T. Injected by the compiler plugin for OlapTable. */
  validators?: TypiaValidators<T>;

  /** Optional metadata for the resource, always present as an object. */
  metadata!: { [key: string]: any };

  /**
   * @internal Constructor intended for internal use by subclasses and the compiler plugin.
   * It expects the schema and columns to be provided, typically injected by the compiler.
   *
   * @param name The name for the resource instance.
   * @param config The configuration object for the resource.
   * @param schema The JSON schema for the resource's data type T (injected).
   * @param columns The array of Column definitions for T (injected).
   */
  constructor(
    name: string,
    config: C,
    schema?: IJsonSchemaCollection.IV3_1,
    columns?: Column[],
    validators?: TypiaValidators<T>,
  ) {
    if (schema === undefined || columns === undefined) {
      throw new Error(
        "Supply the type param T so that the schema is inserted by the compiler plugin.",
      );
    }

    this.schema = schema;
    this.columnArray = columns;
    const columnsObj = {} as any;
    columns.forEach((column) => {
      columnsObj[column.name] = column;
    });
    this.columns = columnsObj;

    this.name = name;
    this.config = config;
    this.validators = validators;

    // Always ensure metadata is an object and attach stackTrace (last 10 lines only)
    this.metadata =
      (config as any)?.metadata ? { ...(config as any).metadata } : {};
    const stack = new Error().stack;
    if (stack) {
      // Add source object with file and line using shared utility
      const info = getSourceFileInfo(stack);
      this.metadata.source = { file: info.file, line: info.line };
    } else {
      this.metadata.source = undefined;
    }
  }
}
