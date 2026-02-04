import { IJsonSchemaCollection } from "typia";
import { ClickHouseEngines } from "../../dataModels/types";
import { Column, DataType } from "../../dataModels/dataModelTypes";
import { OlapConfig, OlapTable } from "./olapTable";
import { Stream, StreamConfig } from "./stream";
import { LifeCycle } from "./lifeCycle";
import { TypedBase, TypiaValidators } from "../typedBase";
import { getMooseInternal } from "../internal";
import { getSourceLocationFromStack } from "../utils/stackTrace";

export type CdcOperation = "insert" | "update" | "delete";

export interface CdcEvent<T> {
  op: CdcOperation;
  before?: T | null;
  after?: T | null;
  ts: Date;
  lsn: string;
  source: string;
}

export type CdcRow<T> = T & {
  __cdc_op: CdcOperation;
  __cdc_lsn: string;
  __cdc_ts: Date;
  __cdc_is_deleted: boolean;
};

export type CdcSourceConfig = {
  kind: string;
  connection: string;
  metadata?: { description?: string };
  lifeCycle?: LifeCycle;
};

export type CdcTableConfig<T> = {
  sourceTable: string;
  primaryKey: Array<keyof T & string>;
  stream?: boolean | Omit<StreamConfig<CdcEvent<T>>, "destination">;
  table?: boolean | OlapConfig<CdcRow<T>>;
  snapshot?: "initial" | "never";
  version?: string;
  metadata?: { description?: string };
  lifeCycle?: LifeCycle;
};

export class CdcSource {
  readonly name: string;
  readonly config: CdcSourceConfig;
  readonly tables: Map<string, CdcTable<any>> = new Map();
  metadata?: {
    description?: string;
    source?: { file?: string; line?: string };
  };

  constructor(name: string, config: CdcSourceConfig) {
    this.name = name;
    this.config = config;

    this.metadata = config.metadata ? { ...config.metadata } : {};
    if (!this.metadata.source) {
      const stack = new Error().stack;
      const info = getSourceLocationFromStack(stack);
      if (info) {
        this.metadata.source = { file: info.file, line: info.line.toString() };
      }
    }

    getMooseInternal().cdcSources.set(name, this);
  }

  registerTable(table: CdcTable<any>) {
    this.tables.set(table.name, table);
  }
}

export class CdcTable<T> extends TypedBase<T, CdcTableConfig<T>> {
  readonly source: CdcSource;
  readonly sourceTable: string;
  stream?: Stream<CdcEvent<T>>;
  changes?: Stream<CdcEvent<T>>;
  table?: OlapTable<CdcRow<T>>;

  constructor(name: string, source: CdcSource, config: CdcTableConfig<T>);

  constructor(
    name: string,
    source: CdcSource,
    config: CdcTableConfig<T>,
    schema?: IJsonSchemaCollection.IV3_1,
    columns?: Column[],
    validators?: TypiaValidators<T>,
    allowExtraFields?: boolean,
  );

  constructor(
    name: string,
    source: CdcSource,
    config: CdcTableConfig<T>,
    schema?: IJsonSchemaCollection.IV3_1,
    columns?: Column[],
    validators?: TypiaValidators<T>,
    allowExtraFields?: boolean,
  ) {
    super(name, config, schema, columns, validators, allowExtraFields);

    this.source = source;
    this.sourceTable = config.sourceTable;
    source.registerTable(this);

    if (!config.primaryKey || config.primaryKey.length === 0) {
      throw new Error(
        `CdcTable '${name}' requires a non-empty primaryKey array.`,
      );
    }

    const metaColumnNames = new Set([
      "__cdc_op",
      "__cdc_lsn",
      "__cdc_ts",
      "__cdc_is_deleted",
    ]);
    for (const col of this.columnArray) {
      if (metaColumnNames.has(col.name)) {
        throw new Error(
          `CdcTable '${name}' uses reserved CDC metadata column name '${col.name}'.`,
        );
      }
    }

    if (config.stream !== false) {
      const eventSchema = buildCdcEventSchema(this.schema);
      const eventColumns = buildCdcEventColumns(this.columnArray);
      const streamConfig: StreamConfig<CdcEvent<T>> = {
        ...(typeof config.stream === "object" ? config.stream : {}),
        lifeCycle: config.lifeCycle,
        ...(config.version && { version: config.version }),
        metadata: config.metadata,
      };

      this.stream = new Stream(
        name,
        streamConfig,
        eventSchema,
        eventColumns,
        undefined,
        false,
      );
      this.changes = this.stream;
    }

    if (config.table) {
      const rowSchema = buildCdcRowSchema(this.schema);
      const rowColumns = buildCdcRowColumns(this.columnArray);
      const baseTableConfig = (
        typeof config.table === "object" ?
          {
            ...config.table,
            lifeCycle: config.table.lifeCycle ?? config.lifeCycle,
            ...(config.version && { version: config.version }),
          }
        : {
            engine: ClickHouseEngines.ReplacingMergeTree,
            orderByFields: config.primaryKey as Array<keyof CdcRow<T> & string>,
            ver: "__cdc_lsn",
            isDeleted: "__cdc_is_deleted",
            lifeCycle: config.lifeCycle,
            ...(config.version && { version: config.version }),
          }) as OlapConfig<CdcRow<T>>;

      if (
        "engine" in baseTableConfig &&
        baseTableConfig.engine === ClickHouseEngines.ReplacingMergeTree
      ) {
        const replacingConfig = baseTableConfig as {
          engine: ClickHouseEngines.ReplacingMergeTree;
          ver?: string;
          isDeleted?: string;
        };
        replacingConfig.ver = replacingConfig.ver ?? "__cdc_lsn";
        replacingConfig.isDeleted =
          replacingConfig.isDeleted ?? "__cdc_is_deleted";
      }

      if (
        "orderByFields" in baseTableConfig &&
        (!baseTableConfig.orderByFields ||
          baseTableConfig.orderByFields.length === 0)
      ) {
        baseTableConfig.orderByFields = config.primaryKey as Array<
          keyof CdcRow<T> & string
        >;
      }

      this.table = new OlapTable(
        name,
        baseTableConfig,
        rowSchema,
        rowColumns,
        undefined,
      );
    }
  }
}

const buildCdcEventSchema = (
  base: IJsonSchemaCollection.IV3_1,
): IJsonSchemaCollection.IV3_1 => {
  const baseSchema = base.schemas[0] as any;
  const nullableBase = {
    anyOf: [baseSchema, { type: "null" }],
  } as any;

  return {
    ...base,
    schemas: [
      {
        type: "object",
        properties: {
          op: { type: "string" },
          before: nullableBase,
          after: nullableBase,
          ts: { type: "string", format: "date-time" },
          lsn: { type: "string" },
          source: { type: "string" },
        },
        required: ["op", "ts", "lsn", "source"],
      } as any,
    ],
  } as IJsonSchemaCollection.IV3_1;
};

const buildCdcRowSchema = (
  base: IJsonSchemaCollection.IV3_1,
): IJsonSchemaCollection.IV3_1 => {
  const baseSchema = base.schemas[0] as any;
  return {
    ...base,
    schemas: [
      {
        allOf: [
          baseSchema,
          {
            type: "object",
            properties: {
              __cdc_op: { type: "string" },
              __cdc_lsn: { type: "string" },
              __cdc_ts: { type: "string", format: "date-time" },
              __cdc_is_deleted: { type: "boolean" },
            },
            required: ["__cdc_op", "__cdc_lsn", "__cdc_ts", "__cdc_is_deleted"],
          },
        ],
      } as any,
    ],
  } as IJsonSchemaCollection.IV3_1;
};

const buildCdcEventColumns = (columns: Column[]): Column[] => {
  const nestedBefore: DataType = {
    name: "before",
    columns,
    jwt: false,
  };
  const nestedAfter: DataType = {
    name: "after",
    columns,
    jwt: false,
  };

  return [
    {
      name: "op",
      data_type: "String",
      primary_key: false,
      required: true,
      unique: false,
      default: null,
      annotations: [],
      ttl: null,
      codec: null,
      materialized: null,
      comment: null,
    },
    {
      name: "before",
      data_type: { nullable: nestedBefore },
      primary_key: false,
      required: false,
      unique: false,
      default: null,
      annotations: [],
      ttl: null,
      codec: null,
      materialized: null,
      comment: null,
    },
    {
      name: "after",
      data_type: { nullable: nestedAfter },
      primary_key: false,
      required: false,
      unique: false,
      default: null,
      annotations: [],
      ttl: null,
      codec: null,
      materialized: null,
      comment: null,
    },
    {
      name: "ts",
      data_type: "DateTime",
      primary_key: false,
      required: true,
      unique: false,
      default: null,
      annotations: [],
      ttl: null,
      codec: null,
      materialized: null,
      comment: null,
    },
    {
      name: "lsn",
      data_type: "String",
      primary_key: false,
      required: true,
      unique: false,
      default: null,
      annotations: [],
      ttl: null,
      codec: null,
      materialized: null,
      comment: null,
    },
    {
      name: "source",
      data_type: "String",
      primary_key: false,
      required: true,
      unique: false,
      default: null,
      annotations: [],
      ttl: null,
      codec: null,
      materialized: null,
      comment: null,
    },
  ];
};

const buildCdcRowColumns = (columns: Column[]): Column[] => [
  ...columns,
  {
    name: "__cdc_op",
    data_type: "String",
    primary_key: false,
    required: true,
    unique: false,
    default: null,
    annotations: [],
    ttl: null,
    codec: null,
    materialized: null,
    comment: null,
  },
  {
    name: "__cdc_lsn",
    data_type: "String",
    primary_key: false,
    required: true,
    unique: false,
    default: null,
    annotations: [],
    ttl: null,
    codec: null,
    materialized: null,
    comment: null,
  },
  {
    name: "__cdc_ts",
    data_type: "DateTime",
    primary_key: false,
    required: true,
    unique: false,
    default: null,
    annotations: [],
    ttl: null,
    codec: null,
    materialized: null,
    comment: null,
  },
  {
    name: "__cdc_is_deleted",
    data_type: "UInt8",
    primary_key: false,
    required: true,
    unique: false,
    default: null,
    annotations: [],
    ttl: null,
    codec: null,
    materialized: null,
    comment: null,
  },
];
