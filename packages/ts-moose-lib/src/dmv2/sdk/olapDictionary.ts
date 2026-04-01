import { IJsonSchemaCollection } from "typia";
import { Column, DataType } from "../../dataModels/dataModelTypes";
import { getMooseInternal, isClientOnlyMode } from "../internal";
import { getSourceFileFromStack } from "../utils/stackTrace";
import { Sql, toStaticQuery } from "../../sqlHelpers";
import { OlapTable } from "./olapTable";
import { View } from "./view";
import { LifeCycle } from "./lifeCycle";

// ─── Column serialization ──────────────────────────────────────────────────────

/**
 * Convert a DataType to a ClickHouse type string.
 * Simple string types are already ClickHouse type strings (e.g. "String", "UInt64").
 * Complex types (Nullable, Array, etc.) are reconstructed from their structured form.
 */
function dataTypeToString(dt: DataType): string {
  if (typeof dt === "string") {
    return dt;
  }
  if (typeof dt === "object" && dt !== null) {
    // Nullable: { nullable: DataType }
    if ("nullable" in dt) {
      return `Nullable(${dataTypeToString((dt as { nullable: DataType }).nullable)})`;
    }
    // ArrayType: { elementType, elementNullable }
    if ("elementType" in dt && "elementNullable" in dt) {
      const elementStr = dataTypeToString(
        (dt as { elementType: DataType; elementNullable: boolean }).elementType,
      );
      const nullable = (
        dt as { elementType: DataType; elementNullable: boolean }
      ).elementNullable;
      return `Array(${nullable ? `Nullable(${elementStr})` : elementStr})`;
    }
    // NamedTupleType: { fields: Array<[string, DataType]> }
    if ("fields" in dt && Array.isArray((dt as any).fields)) {
      const fields = (dt as { fields: Array<[string, DataType]> }).fields
        .map(([name, type]) => `${name} ${dataTypeToString(type)}`)
        .join(", ");
      return `Tuple(${fields})`;
    }
    // MapType: { keyType, valueType }
    if ("keyType" in dt && "valueType" in dt) {
      const keyStr = dataTypeToString(
        (dt as { keyType: DataType; valueType: DataType }).keyType,
      );
      const valStr = dataTypeToString(
        (dt as { keyType: DataType; valueType: DataType }).valueType,
      );
      return `Map(${keyStr}, ${valStr})`;
    }
    // DataEnum: { name, values }
    if ("name" in dt && "values" in dt) {
      const enumDt = dt as { name: string; values: any[] };
      if (Array.isArray(enumDt.values) && enumDt.values.length > 0) {
        const first = enumDt.values[0];
        const isIntEnum = first.value && "Int" in first.value;
        const enumType = isIntEnum ? "Enum8" : "Enum16";
        const entries = enumDt.values
          .map((v: any) => {
            if (v.value && "Int" in v.value) {
              return `'${v.name}' = ${v.value.Int}`;
            }
            return `'${v.name}'`;
          })
          .join(", ");
        return `${enumType}(${entries})`;
      }
      return "String";
    }
    // Nested: { name, columns, jwt }
    if ("columns" in dt && Array.isArray((dt as any).columns)) {
      // Dictionary columns don't support Nested types; fall back to String
      return "String";
    }
  }
  return "String";
}

/**
 * Convert a Column to a DictionaryColumnJson, using the defaultValue if provided.
 */
function columnToDictionaryColumnJson(
  column: Column,
  defaultValue?: any,
): DictionaryColumnJson {
  let typeStr = dataTypeToString(column.data_type);
  // Wrap non-required (optional) fields in Nullable unless already nullable
  if (!column.required && !typeStr.startsWith("Nullable(")) {
    typeStr = `Nullable(${typeStr})`;
  }
  return {
    name: column.name,
    typeString: typeStr,
    defaultValue: defaultValue !== undefined ? String(defaultValue) : undefined,
    isInjective: undefined,
    isHierarchical: undefined,
    isObjectId: undefined,
    comment: column.comment ?? undefined,
  };
}

// ─── JSON serialization types ──────────────────────────────────────────────────

/**
 * JSON representation of a dictionary column (matches Rust DictionaryColumn serde).
 */
export interface DictionaryColumnJson {
  name: string;
  typeString: string;
  defaultValue?: string;
  expression?: string;
  isInjective?: boolean;
  isHierarchical?: boolean;
  isObjectId?: boolean;
  comment?: string;
}

/**
 * TABLE source: read from a local ClickHouse table.
 */
export interface DictionaryTableSourceConfig {
  type: "TABLE";
  table: string;
  database?: string;
  whereClause?: string;
  invalidateQuery?: string;
}

/**
 * QUERY source: read from an arbitrary SQL query on the local ClickHouse server.
 */
export interface DictionaryQuerySourceConfig {
  type: "QUERY";
  query: string;
  invalidateQuery?: string;
}

/**
 * CLICK_HOUSE external source.
 */
export interface DictionaryClickHouseExternalSource {
  type: "CLICK_HOUSE";
  host: string;
  port: number;
  user: string;
  password: string;
  db: string;
  table: string;
  query?: string;
  whereClause?: string;
  invalidateQuery?: string;
}

/**
 * HTTP external source.
 */
export interface DictionaryHttpExternalSource {
  type: "HTTP";
  url: string;
  format: string;
  method?: string;
  whereClause?: string;
}

/**
 * MySQL external source.
 */
export interface DictionaryMysqlExternalSource {
  type: "MYSQL";
  host: string;
  port: number;
  user: string;
  password: string;
  db: string;
  table: string;
  query?: string;
  whereClause?: string;
  invalidateQuery?: string;
}

/**
 * PostgreSQL external source.
 */
export interface DictionaryPostgresqlExternalSource {
  type: "POSTGRESQL";
  host: string;
  port: number;
  user: string;
  password: string;
  db: string;
  table: string;
  query?: string;
  whereClause?: string;
  invalidateQuery?: string;
}

/**
 * Redis external source.
 */
export interface DictionaryRedisExternalSource {
  type: "REDIS";
  host: string;
  port: number;
  password?: string;
  dbIndex?: number;
  storageType: string;
}

/**
 * MongoDB external source.
 */
export interface DictionaryMongoDbExternalSource {
  type: "MONGODB";
  host: string;
  port: number;
  user: string;
  password: string;
  db: string;
  collection: string;
}

/**
 * Executable external source.
 */
export interface DictionaryExecutableExternalSource {
  type: "EXECUTABLE";
  command: string;
  format: string;
  implicitKey?: boolean;
}

/**
 * S3 external source.
 */
export interface DictionaryS3ExternalSource {
  type: "S3";
  url: string;
  format: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * All possible external dictionary sources (discriminated union).
 */
export type ExternalDictionarySourceConfig =
  | DictionaryClickHouseExternalSource
  | DictionaryHttpExternalSource
  | DictionaryMysqlExternalSource
  | DictionaryPostgresqlExternalSource
  | DictionaryRedisExternalSource
  | DictionaryMongoDbExternalSource
  | DictionaryExecutableExternalSource
  | DictionaryS3ExternalSource;

/**
 * EXTERNAL source wrapper that holds an external source config.
 */
export interface DictionaryExternalSourceConfig {
  type: "EXTERNAL";
  source: ExternalDictionarySourceConfig;
}

/**
 * Dictionary source config (user-facing).
 */
export type DictionarySourceConfig =
  | DictionaryTableSourceConfig
  | DictionaryQuerySourceConfig
  | DictionaryExternalSourceConfig;

// ─── Layout types ─────────────────────────────────────────────────────────────

export type DictionaryLayoutType =
  | "FLAT"
  | "HASHED"
  | "SPARSE_HASHED"
  | "HASHED_ARRAY"
  | "RANGE_HASHED"
  | "CACHE"
  | "SSD_CACHE"
  | "DIRECT"
  | "IP_TRIE"
  | "COMPLEX_KEY_HASHED"
  | "COMPLEX_KEY_SPARSE_HASHED"
  | "COMPLEX_KEY_HASHED_ARRAY"
  | "COMPLEX_KEY_CACHE"
  | "COMPLEX_KEY_SSD_CACHE"
  | "COMPLEX_KEY_DIRECT";

export interface FlatLayout {
  type: "FLAT";
}

export interface HashedLayout {
  type: "HASHED";
  initialArraySize?: number;
  maxLoadFactor?: number;
}

export interface SparseHashedLayout {
  type: "SPARSE_HASHED";
  initialArraySize?: number;
  maxLoadFactor?: number;
}

export interface HashedArrayLayout {
  type: "HASHED_ARRAY";
  shards?: number;
}

export interface RangeHashedLayout {
  type: "RANGE_HASHED";
  rangeLookupStrategy?: string;
}

export interface CacheLayout {
  type: "CACHE";
  sizeInCells: number;
  maxThreadsForUpdates?: number;
}

export interface SsdCacheLayout {
  type: "SSD_CACHE";
  path: string;
  blockSize?: number;
  fileSize?: number;
  readBufferSize?: number;
  writeBufferSize?: number;
  maxStoredKeys?: number;
}

export interface DirectLayout {
  type: "DIRECT";
}

export interface IpTrieLayout {
  type: "IP_TRIE";
  accessToKeyFromAttributes?: boolean;
}

export interface ComplexKeyHashedLayout {
  type: "COMPLEX_KEY_HASHED";
  initialArraySize?: number;
  maxLoadFactor?: number;
}

export interface ComplexKeySparseHashedLayout {
  type: "COMPLEX_KEY_SPARSE_HASHED";
  initialArraySize?: number;
  maxLoadFactor?: number;
}

export interface ComplexKeyHashedArrayLayout {
  type: "COMPLEX_KEY_HASHED_ARRAY";
  shards?: number;
}

export interface ComplexKeyCacheLayout {
  type: "COMPLEX_KEY_CACHE";
  sizeInCells: number;
  maxThreadsForUpdates?: number;
}

export interface ComplexKeySsdCacheLayout {
  type: "COMPLEX_KEY_SSD_CACHE";
  path: string;
  blockSize?: number;
  fileSize?: number;
  readBufferSize?: number;
  writeBufferSize?: number;
  maxStoredKeys?: number;
}

export interface ComplexKeyDirectLayout {
  type: "COMPLEX_KEY_DIRECT";
}

export type DictionaryLayoutConfig =
  | FlatLayout
  | HashedLayout
  | SparseHashedLayout
  | HashedArrayLayout
  | RangeHashedLayout
  | CacheLayout
  | SsdCacheLayout
  | DirectLayout
  | IpTrieLayout
  | ComplexKeyHashedLayout
  | ComplexKeySparseHashedLayout
  | ComplexKeyHashedArrayLayout
  | ComplexKeyCacheLayout
  | ComplexKeySsdCacheLayout
  | ComplexKeyDirectLayout;

// ─── Lifetime types ───────────────────────────────────────────────────────────

/**
 * Dictionary lifetime configuration.
 * - A single number N means SINGLE lifetime (refresh every N seconds).
 * - 0 means STATIC lifetime (never refresh).
 * - An object { min, max } means RANGE lifetime.
 */
export type DictionaryLifetimeConfig = number | { min: number; max: number };

// ─── Serialized JSON types ─────────────────────────────────────────────────────

/**
 * Serialized lifetime format matching Rust serde output.
 */
type LifetimeJson =
  | { type: "STATIC" }
  | { type: "SINGLE"; seconds: number }
  | { type: "RANGE"; min: number; max: number };

/**
 * Serialized source format matching Rust serde output.
 * TABLE and QUERY are top-level variants.
 * EXTERNAL wraps an inner source with its own `type` field.
 */
type SourceJson =
  | {
      type: "TABLE";
      table: string;
      database?: string;
      whereClause?: string;
      invalidateQuery?: string;
    }
  | { type: "QUERY"; query: string; invalidateQuery?: string }
  | { type: "EXTERNAL"; source: ExternalDictionarySourceConfig };

/**
 * JSON shape for OlapDictionary that Rust expects (camelCase via serde rename_all).
 */
export interface OlapDictionaryJson {
  name: string;
  database?: string;
  clusterName?: string;
  source: SourceJson;
  primaryKey: string[];
  columns: DictionaryColumnJson[];
  layout: DictionaryLayoutConfig;
  lifetime: LifetimeJson;
  invalidateQuery?: string;
  settings: Record<string, string>;
  comment?: string;
  lifeCycle?: string;
  metadata?: { [key: string]: any };
}

// ─── Config helpers ───────────────────────────────────────────────────────────

function serializeLifetime(lt: DictionaryLifetimeConfig): LifetimeJson {
  if (typeof lt === "number") {
    if (lt === 0) {
      return { type: "STATIC" };
    }
    return { type: "SINGLE", seconds: lt };
  }
  return { type: "RANGE", min: lt.min, max: lt.max };
}

function serializeSource(src: DictionarySourceConfig): SourceJson {
  if (src.type === "TABLE") {
    const { type, table, database, whereClause, invalidateQuery } = src;
    return { type, table, database, whereClause, invalidateQuery };
  }
  if (src.type === "QUERY") {
    const { type, query, invalidateQuery } = src;
    return { type, query, invalidateQuery };
  }
  // EXTERNAL: Rust uses `External { source: ExternalDictionarySource }` (named field),
  // producing {"type":"EXTERNAL","source":{"type":"HTTP",...}}.
  // This avoids duplicate "type" keys that standard JSON.stringify cannot produce.
  const { source: innerSource } = src;
  return { type: "EXTERNAL", source: innerSource };
}

// ─── OlapDictionaryConfig ─────────────────────────────────────────────────────

/**
 * Configuration for creating an OlapDictionary.
 * @template T The TypeScript type whose fields define the dictionary's column schema.
 */
export interface OlapDictionaryConfig<T> {
  /**
   * Source: an OlapTable or View on the same ClickHouse server.
   * Automatically generates a TABLE source with the table name.
   * Mutually exclusive with sourceQuery and externalSource.
   */
  sourceTable?: OlapTable<any> | View;

  /**
   * Source: an arbitrary SQL query on the local ClickHouse server.
   * Mutually exclusive with sourceTable and externalSource.
   */
  sourceQuery?: Sql;

  /**
   * Source: an external system.
   * Mutually exclusive with sourceTable and sourceQuery.
   */
  externalSource?: ExternalDictionarySourceConfig;

  /**
   * Source tables referenced by sourceQuery (used for dependency tracking).
   * Only relevant when sourceQuery is provided.
   */
  sourceTables?: (OlapTable<any> | View)[];

  /**
   * Primary key column names.
   * Single column → simple key layouts (FLAT, HASHED, etc.).
   * Multiple columns → COMPLEX_KEY_* layouts.
   */
  primaryKey: (keyof T & string)[];

  /**
   * Memory layout / storage model.
   * Defaults to HASHED if not specified.
   */
  layout?: DictionaryLayoutConfig;

  /**
   * Refresh policy.
   * - 0 = never refresh (STATIC)
   * - number N = refresh every N seconds (SINGLE)
   * - { min, max } = refresh between min and max seconds (RANGE)
   * Defaults to 3600 (refresh every hour).
   */
  lifetime?: DictionaryLifetimeConfig;

  /**
   * Top-level invalidation query.
   * If the query result is unchanged since the last load, the dictionary is not reloaded.
   */
  invalidateQuery?: string;

  /**
   * Optional database name. Uses the default database if not specified.
   */
  database?: string;

  /**
   * Optional ON CLUSTER name for distributed ClickHouse deployments.
   */
  clusterName?: string;

  /**
   * Default values for specific columns.
   * Maps column names to default values used when a key is not found.
   */
  defaults?: Partial<{ [K in keyof T]: T[K] }>;

  /**
   * Dictionary-level ClickHouse settings.
   */
  settings?: Record<string, string | number>;

  /**
   * Optional comment for the dictionary.
   */
  comment?: string;

  /**
   * Lifecycle management policy for the dictionary.
   * Defaults to FULLY_MANAGED if not specified.
   */
  lifeCycle?: LifeCycle;

  /**
   * Optional metadata (e.g., description, source file).
   */
  metadata?: { [key: string]: any };
}

// ─── OlapDictionary class ─────────────────────────────────────────────────────

/**
 * Represents a ClickHouse Dictionary — an in-memory key-value store for fast lookups.
 *
 * Dictionaries can be backed by local ClickHouse tables/queries or external systems.
 * They are refreshed automatically according to the configured lifetime policy.
 *
 * @template T The TypeScript type whose fields define the dictionary's column schema.
 *
 * @example
 * ```typescript
 * interface UserAttributes {
 *   userId: string;
 *   displayName: string;
 *   tier: string;
 * }
 *
 * const userDict = new OlapDictionary<UserAttributes>("user_attributes", {
 *   sourceTable: usersTable,
 *   primaryKey: ["userId"],
 *   layout: { type: "HASHED" },
 *   lifetime: 3600,
 * });
 *
 * // Use in a query
 * const query = sql.statement`
 *   SELECT event_id, ${userDict.get("displayName", sql.fragment`event_user_id`)} as user_name
 *   FROM events
 * `;
 * ```
 */
export class OlapDictionary<T> {
  /** @internal */
  public readonly kind = "OlapDictionary";

  /** The name of the dictionary */
  name: string;

  /** The configuration for this dictionary */
  config: OlapDictionaryConfig<T>;

  /** The resolved dictionary source config */
  source: DictionarySourceConfig;

  /** Column definitions from the type parameter T */
  columns: DictionaryColumnJson[];

  /** Optional metadata */
  metadata: { [key: string]: any };

  /**
   * Creates a new OlapDictionary instance.
   * @param name The name of the dictionary.
   * @param config Configuration for the dictionary.
   */
  constructor(name: string, config: OlapDictionaryConfig<T>);

  /** @internal **/
  constructor(
    name: string,
    config: OlapDictionaryConfig<T>,
    _schema: IJsonSchemaCollection.IV3_1,
    columns: Column[],
  );

  constructor(
    name: string,
    config: OlapDictionaryConfig<T>,
    _schema?: IJsonSchemaCollection.IV3_1,
    columns?: Column[],
  ) {
    if (_schema === undefined || columns === undefined) {
      throw new Error(
        "Supply the type param T so that the schema is inserted by the compiler plugin.",
      );
    }

    this.name = name;
    this.config = config;

    // Resolve the source
    this.source = resolveSource(config);

    // Convert Column[] to DictionaryColumnJson[]
    const defaults = config.defaults ?? {};
    this.columns = columns.map((col) =>
      columnToDictionaryColumnJson(col, (defaults as any)[col.name]),
    );

    // Initialize metadata
    this.metadata = config.metadata ? { ...config.metadata } : {};

    // Capture source file from stack trace if not already provided
    if (!this.metadata.source) {
      const stack = new Error().stack;
      const sourceInfo = getSourceFileFromStack(stack);
      if (sourceInfo) {
        this.metadata.source = { file: sourceInfo };
      }
    }

    // Register in the olapDictionaries registry
    const olapDictionaries = getMooseInternal().olapDictionaries;
    if (!isClientOnlyMode() && olapDictionaries.has(this.name)) {
      throw new Error(`OlapDictionary with name ${this.name} already exists`);
    }
    olapDictionaries.set(this.name, this);
  }

  /**
   * Serializes this dictionary to the JSON format expected by the Rust CLI.
   */
  toJson(): OlapDictionaryJson {
    const layout = this.config.layout ?? { type: "HASHED" as const };
    const lifetime = this.config.lifetime ?? 3600;
    const settings =
      this.config.settings ?
        Object.fromEntries(
          Object.entries(this.config.settings).map(([k, v]) => [k, String(v)]),
        )
      : {};

    return {
      name: this.name,
      database: this.config.database,
      clusterName: this.config.clusterName,
      source: serializeSource(this.source),
      primaryKey: this.config.primaryKey as string[],
      columns: this.columns,
      layout,
      lifetime: serializeLifetime(lifetime),
      invalidateQuery: this.config.invalidateQuery,
      settings,
      comment: this.config.comment,
      lifeCycle: this.config.lifeCycle,
      metadata: this.metadata,
    };
  }

  /**
   * Generates a `dictGet(dictionary, attribute, key)` SQL expression.
   *
   * @param attribute - The attribute column name to look up.
   * @param key - A SQL fragment or expression representing the key value(s).
   * @returns A SQL fragment: `dictGet('db.dict_name', 'attr', key)`
   */
  get(attribute: keyof T & string, key: Sql): Sql {
    const dictRef =
      this.config.database ? `${this.config.database}.${this.name}` : this.name;
    return buildDictGetSql("dictGet", dictRef, attribute, key);
  }

  /**
   * Generates a `dictGetOrDefault(dictionary, attribute, key, defaultValue)` SQL expression.
   *
   * @param attribute - The attribute column name to look up.
   * @param key - A SQL fragment or expression representing the key value(s).
   * @param defaultValue - The default value to use when the key is not found.
   * @returns A SQL fragment: `dictGetOrDefault('db.dict_name', 'attr', key, default)`
   */
  getOrDefault(attribute: keyof T & string, key: Sql, defaultValue: Sql): Sql {
    const dictRef =
      this.config.database ? `${this.config.database}.${this.name}` : this.name;
    return buildDictGetOrDefaultSql(dictRef, attribute, key, defaultValue);
  }

  /**
   * Generates a `dictHas(dictionary, key)` SQL expression.
   *
   * @param key - A SQL fragment or expression representing the key value(s).
   * @returns A SQL fragment: `dictHas('db.dict_name', key)`
   */
  has(key: Sql): Sql {
    const dictRef =
      this.config.database ? `${this.config.database}.${this.name}` : this.name;
    return buildDictHasSql(dictRef, key);
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function resolveSource<T>(
  config: OlapDictionaryConfig<T>,
): DictionarySourceConfig {
  const sourcesProvided = [
    config.sourceTable !== undefined,
    config.sourceQuery !== undefined,
    config.externalSource !== undefined,
  ].filter(Boolean).length;

  if (sourcesProvided > 1) {
    throw new Error(
      "OlapDictionary: provide exactly one of sourceTable, sourceQuery, or externalSource.",
    );
  }

  if (config.sourceTable !== undefined) {
    const table = config.sourceTable;
    const tableName =
      table instanceof OlapTable ? table.generateTableName() : table.name;
    const database =
      table instanceof OlapTable ? table.config.database : undefined;
    return {
      type: "TABLE" as const,
      table: tableName,
      database,
    };
  }

  if (config.sourceQuery !== undefined) {
    const query = toStaticQuery(config.sourceQuery);
    return {
      type: "QUERY" as const,
      query,
    };
  }

  if (config.externalSource !== undefined) {
    return {
      type: "EXTERNAL" as const,
      source: config.externalSource,
    };
  }

  throw new Error(
    "OlapDictionary: one of sourceTable, sourceQuery, or externalSource must be provided.",
  );
}

/** Build a dictGet SQL fragment using raw string interpolation */
function buildDictGetSql(
  fnName: string,
  dictRef: string,
  attribute: string,
  key: Sql,
): Sql {
  // We need to produce: dictGet('dictRef', 'attribute', <key>)
  // We do this by creating a new Sql instance that wraps the key fragment
  const prefix = `${fnName}('${dictRef}', '${attribute}', `;
  const suffix = ")";
  return new Sql([prefix, suffix], [key], true);
}

/** Build a dictGetOrDefault SQL fragment */
function buildDictGetOrDefaultSql(
  dictRef: string,
  attribute: string,
  key: Sql,
  defaultValue: Sql,
): Sql {
  const prefix = `dictGetOrDefault('${dictRef}', '${attribute}', `;
  const between = ", ";
  const suffix = ")";
  return new Sql([prefix, between, suffix], [key, defaultValue], true);
}

/** Build a dictHas SQL fragment */
function buildDictHasSql(dictRef: string, key: Sql): Sql {
  const prefix = `dictHas('${dictRef}', `;
  const suffix = ")";
  return new Sql([prefix, suffix], [key], true);
}
