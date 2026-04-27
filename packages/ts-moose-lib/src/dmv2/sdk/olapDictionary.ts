import { IJsonSchemaCollection } from "typia";
import { Column } from "../../dataModels/dataModelTypes";
import { getMooseInternal, isClientOnlyMode } from "../internal";
import { OlapTable } from "./olapTable";
import { View } from "./view";
import { LifeCycle } from "./lifeCycle";
import { Sql, sql, toStaticQuery } from "../../sqlHelpers";
import { getSourceFileFromStack } from "../utils/stackTrace";

// ─── Column attributes ────────────────────────────────────────────────────────

/**
 * Per-column attribute configuration for dictionary attributes.
 * The column name and ClickHouse type are inferred from the TypeScript generic T.
 * This object carries optional ClickHouse dictionary attribute flags.
 */
export interface DictionaryColumnConfig {
  /** DEFAULT expression — fallback value when key is not found */
  defaultValue?: string;
  /** EXPRESSION attribute — computed from other columns */
  expression?: string;
  /** IS_INJECTIVE — enables GROUP BY optimization (one-to-one mapping) */
  isInjective?: boolean;
  /** IS_HIERARCHICAL — enables hierarchical parent-child lookups */
  isHierarchical?: boolean;
  /** IS_OBJECT_ID — MongoDB-specific attribute */
  isObjectId?: boolean;
  /** Optional column comment */
  comment?: string;
}

// ─── Layouts ──────────────────────────────────────────────────────────────────

/**
 * ClickHouse dictionary layout types.
 * All 16 layout variants with their per-layout parameters.
 * The `type` field uses SCREAMING_SNAKE_CASE to match Rust serde.
 */
export type DictionaryLayout =
  | { type: "FLAT" }
  | { type: "HASHED"; initialArraySize?: number; maxLoadFactor?: number }
  | { type: "SPARSE_HASHED"; initialArraySize?: number; maxLoadFactor?: number }
  | { type: "HASHED_ARRAY"; shards?: number }
  | { type: "RANGE_HASHED"; rangeLookupStrategy?: string }
  | { type: "CACHE"; sizeInCells: number; maxThreadsForUpdates?: number }
  | {
      type: "SSD_CACHE";
      path: string;
      blockSize?: number;
      fileSize?: number;
      readBufferSize?: number;
      writeBufferSize?: number;
      maxStoredKeys?: number;
    }
  | { type: "DIRECT" }
  | { type: "IP_TRIE"; accessToKeyFromAttributes?: boolean }
  | {
      type: "COMPLEX_KEY_HASHED";
      initialArraySize?: number;
      maxLoadFactor?: number;
    }
  | {
      type: "COMPLEX_KEY_SPARSE_HASHED";
      initialArraySize?: number;
      maxLoadFactor?: number;
    }
  | { type: "COMPLEX_KEY_HASHED_ARRAY"; shards?: number }
  | {
      type: "COMPLEX_KEY_CACHE";
      sizeInCells: number;
      maxThreadsForUpdates?: number;
    }
  | {
      type: "COMPLEX_KEY_SSD_CACHE";
      path: string;
      blockSize?: number;
      fileSize?: number;
      readBufferSize?: number;
      writeBufferSize?: number;
      maxStoredKeys?: number;
    }
  | { type: "COMPLEX_KEY_DIRECT" };

/** Set of COMPLEX_KEY_* layouts that require multiple primary key columns */
export const COMPLEX_KEY_LAYOUTS = new Set<DictionaryLayout["type"]>([
  "COMPLEX_KEY_HASHED",
  "COMPLEX_KEY_SPARSE_HASHED",
  "COMPLEX_KEY_HASHED_ARRAY",
  "COMPLEX_KEY_CACHE",
  "COMPLEX_KEY_SSD_CACHE",
  "COMPLEX_KEY_DIRECT",
]);

// ─── Lifetime ─────────────────────────────────────────────────────────────────

/**
 * Dictionary lifetime configuration.
 * - `0` → LIFETIME(0) — static, never reloads
 * - `N` (positive number) → LIFETIME(N) — reload every N seconds
 * - `{ min: N, max: M }` → LIFETIME(MIN N MAX M) — reload with jitter
 */
export type DictionaryLifetime = number | { min: number; max: number };

// ─── External sources ─────────────────────────────────────────────────────────

/** HTTP endpoint source */
export interface HttpExternalSource {
  type: "http";
  url: string;
  format: string;
  method?: string;
  whereClause?: string;
}

/** Remote ClickHouse server source */
export interface ClickHouseExternalSource {
  type: "clickhouse";
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

/** MySQL database source */
export interface MysqlExternalSource {
  type: "mysql";
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

/** PostgreSQL database source */
export interface PostgresqlExternalSource {
  type: "postgresql";
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

/** Redis source */
export interface RedisExternalSource {
  type: "redis";
  host: string;
  port: number;
  password?: string;
  dbIndex?: number;
  /** Storage type: "simple", "hash", "range_hashed", etc. */
  storageType: string;
}

/** MongoDB collection source */
export interface MongodbExternalSource {
  type: "mongodb";
  host: string;
  port: number;
  user: string;
  password: string;
  db: string;
  collection: string;
}

/** External executable process source */
export interface ExecutableExternalSource {
  type: "executable";
  command: string;
  format: string;
  implicitKey?: boolean;
}

/** S3 object storage source */
export interface S3ExternalSource {
  type: "s3";
  url: string;
  format: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/** Union of all supported external source types */
export type ExternalSource =
  | HttpExternalSource
  | ClickHouseExternalSource
  | MysqlExternalSource
  | PostgresqlExternalSource
  | RedisExternalSource
  | MongodbExternalSource
  | ExecutableExternalSource
  | S3ExternalSource;

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Configuration for creating an OlapDictionary.
 *
 * Exactly ONE of `sourceTable`, `sourceQuery`, or `externalSource` must be set.
 */
export interface OlapDictionaryConfig<T> {
  // ── Source (exactly one must be set) ──────────────────────────────────────
  /**
   * Read from a local ClickHouse table managed by Moose.
   * Moose automatically tracks this as a dependency.
   */
  sourceTable?: OlapTable<any> | View;

  /**
   * Read from an arbitrary SQL query on the local ClickHouse.
   * Requires `sourceTables` to be set for dependency tracking.
   * Use the `sql` template tag: `sql\`SELECT ...\``
   */
  sourceQuery?: Sql;

  /**
   * The tables referenced in `sourceQuery`.
   * Required when `sourceQuery` is set to enable dependency tracking.
   */
  sourceTables?: (OlapTable<any> | View)[];

  /**
   * Read from an external data source (HTTP, MySQL, PostgreSQL, Redis, etc.).
   * Use `mooseRuntimeEnv.get()` for credentials — never hardcode secrets.
   */
  externalSource?: ExternalSource;

  // ── Key and attributes ────────────────────────────────────────────────────
  /** Primary key column names. Use a single column for simple layouts (FLAT, HASHED, CACHE, DIRECT, IP_TRIE, RANGE_HASHED) and multiple columns for COMPLEX_KEY_* layouts. */
  primaryKey: (keyof T & string)[];

  /** Per-column attribute overrides (DEFAULT, EXPRESSION, INJECTIVE, HIERARCHICAL, IS_OBJECT_ID). Column names and types are inferred from T. */
  columns?: Partial<Record<keyof T & string, DictionaryColumnConfig>>;

  // ── Memory model ──────────────────────────────────────────────────────────
  /** Dictionary memory layout. Controls in-memory data structure and lookup performance. */
  layout: DictionaryLayout;

  /** Refresh policy: 0 = static, N = every N seconds, { min, max } = random interval */
  lifetime: DictionaryLifetime;

  // ── Optional ──────────────────────────────────────────────────────────────
  /** Database where the dictionary is created. Defaults to the project's default database. */
  database?: string;

  /** ON CLUSTER name for distributed ClickHouse deployments. */
  clusterName?: string;

  /** Optional top-level INVALIDATE_QUERY expression. */
  invalidateQuery?: string;

  /** Additional ClickHouse dictionary settings (key=value pairs). */
  settings?: Record<string, string>;

  /** Optional dictionary COMMENT. */
  comment?: string;

  /** Lifecycle management policy. Defaults to FULLY_MANAGED. */
  lifeCycle?: LifeCycle;

  /** Optional metadata for documentation and tooling. */
  metadata?: { description?: string; [key: string]: any };
}

// ─── Serialization helpers ────────────────────────────────────────────────────

/** JSON shape for a single DictionaryColumn, matching Rust's #[serde(rename_all = "camelCase")] */
interface DictionaryColumnJson {
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
 * Convert a Moose Column's data_type to a ClickHouse type string.
 * Handles the common scalar types. Complex types (Nested, NamedTuple, etc.)
 * are not typical for dictionaries and fall back to a JSON representation.
 */
function dataTypeToString(dataType: Column["data_type"]): string {
  if (typeof dataType === "string") {
    return dataType;
  }
  if (typeof dataType === "object" && dataType !== null) {
    if ("nullable" in dataType) {
      const inner = dataTypeToString(
        (dataType as { nullable: Column["data_type"] }).nullable,
      );
      return `Nullable(${inner})`;
    }
    if ("elementType" in dataType) {
      const arr = dataType as {
        elementType: Column["data_type"];
        elementNullable: boolean;
      };
      const inner = dataTypeToString(arr.elementType);
      return arr.elementNullable ?
          `Array(Nullable(${inner}))`
        : `Array(${inner})`;
    }
    if ("name" in dataType && "values" in dataType) {
      // DataEnum — render as Enum8/Enum16 type string
      const d = dataType as {
        name: string;
        values: { name: string; value: { Int?: number; String?: string } }[];
      };
      const entries = d.values
        .map((v) =>
          v.value.String !== undefined ?
            `'${v.name}' = '${v.value.String}'`
          : `'${v.name}' = ${v.value.Int ?? 0}`,
        )
        .join(", ");
      return `${d.name}(${entries})`;
    }
  }
  return JSON.stringify(dataType);
}

/**
 * Build the DictionaryColumn JSON array from the compiler-injected columns
 * and the user's per-column config overrides.
 */
function buildDictionaryColumns(
  columns: Column[],
  overrides: Record<string, DictionaryColumnConfig> | undefined,
): DictionaryColumnJson[] {
  return columns.map((col) => {
    const override = overrides?.[col.name] ?? {};
    const result: DictionaryColumnJson = {
      name: col.name,
      typeString: dataTypeToString(col.data_type),
    };
    if (override.defaultValue !== undefined)
      result.defaultValue = override.defaultValue;
    if (override.expression !== undefined)
      result.expression = override.expression;
    if (override.isInjective !== undefined)
      result.isInjective = override.isInjective;
    if (override.isHierarchical !== undefined)
      result.isHierarchical = override.isHierarchical;
    if (override.isObjectId !== undefined)
      result.isObjectId = override.isObjectId;
    if (override.comment !== undefined) result.comment = override.comment;
    return result;
  });
}

/**
 * Serialize the user-provided lifetime to the Rust-compatible JSON shape.
 * DictionaryLifetime uses #[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")].
 */
function serializeLifetime(
  lifetime: DictionaryLifetime,
): Record<string, unknown> {
  if (typeof lifetime === "number") {
    if (
      !Number.isFinite(lifetime) ||
      lifetime < 0 ||
      !Number.isInteger(lifetime)
    ) {
      throw new Error(
        `OlapDictionary: lifetime must be a finite non-negative integer (got ${lifetime}).`,
      );
    }
    if (lifetime === 0) {
      return { type: "STATIC" };
    }
    return { type: "SINGLE", seconds: lifetime };
  }
  if (
    !Number.isFinite(lifetime.min) ||
    !Number.isFinite(lifetime.max) ||
    !Number.isInteger(lifetime.min) ||
    !Number.isInteger(lifetime.max) ||
    lifetime.min < 0 ||
    lifetime.max < lifetime.min
  ) {
    throw new Error(
      `OlapDictionary: lifetime range must use finite non-negative integers with min <= max (got min=${lifetime.min}, max=${lifetime.max}).`,
    );
  }
  if (lifetime.min === 0 && lifetime.max === 0) {
    return { type: "STATIC" };
  }
  if (lifetime.min === lifetime.max) {
    return { type: "SINGLE", seconds: lifetime.min };
  }
  return { type: "RANGE", min: lifetime.min, max: lifetime.max };
}

/**
 * Serialize a DictionaryLayout to the JSON shape Rust expects.
 * The variant discriminant (type) uses SCREAMING_SNAKE_CASE; field names within
 * each variant are snake_case (Rust default — no rename_all on fields).
 */
function serializeLayout(layout: DictionaryLayout): Record<string, unknown> {
  const { type, ...rest } = layout as { type: string; [k: string]: unknown };
  const snakeCaseFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    const snake = key.replace(/([A-Z])/g, "_$1").toLowerCase();
    snakeCaseFields[snake] = value;
  }
  return { type, ...snakeCaseFields };
}

/**
 * Serialize the external source type string to SCREAMING_SNAKE_CASE for Rust.
 */
function externalTypeToRust(type: ExternalSource["type"]): string {
  const mapping: Record<ExternalSource["type"], string> = {
    http: "HTTP",
    clickhouse: "CLICK_HOUSE",
    mysql: "MYSQL",
    postgresql: "POSTGRESQL",
    redis: "REDIS",
    mongodb: "MONGODB",
    executable: "EXECUTABLE",
    s3: "S3",
  };
  return mapping[type];
}

/**
 * Serialize the ExternalSource to the Rust-compatible JSON shape.
 *
 * NOTE: The Rust DictionarySource::External(ExternalDictionarySource) uses
 * nested #[serde(tag = "type")] enums. Due to a known serde limitation with
 * nested internally-tagged enums (both use the same "type" key), we serialize
 * External sources with the inner ExternalDictionarySource nested under
 * "externalSource". The Rust side will need a matching custom deserializer.
 * See: https://github.com/serde-rs/serde/issues/1799
 */
function serializeExternalSource(ext: ExternalSource): Record<string, unknown> {
  const { type, ...rest } = ext;
  // Convert camelCase config fields to the expected format
  const inner: Record<string, unknown> = {
    source_type: externalTypeToRust(type),
  };

  // Map camelCase user fields to camelCase JSON (matching Rust struct serde)
  for (const [key, value] of Object.entries(rest)) {
    inner[key] = value;
  }

  return {
    type: "EXTERNAL",
    externalSource: inner,
  };
}

/**
 * Serialize the dictionary source to the Rust-compatible JSON shape.
 * DictionarySource uses #[serde(tag = "type", rename_all = "SCREAMING_SNAKE_CASE")].
 */
function serializeSource(
  config: OlapDictionaryConfig<any>,
): Record<string, unknown> {
  if (config.sourceTable !== undefined) {
    const table = config.sourceTable;
    if (table instanceof OlapTable) {
      return {
        type: "TABLE",
        table: table.generateTableName(),
        database: table.config.database,
        ...(config.invalidateQuery !== undefined ?
          { invalidateQuery: config.invalidateQuery }
        : {}),
      };
    } else {
      // View
      return {
        type: "TABLE",
        table: table.name,
        database: table.database,
        ...(config.invalidateQuery !== undefined ?
          { invalidateQuery: config.invalidateQuery }
        : {}),
      };
    }
  }

  if (config.sourceQuery !== undefined) {
    return {
      type: "QUERY",
      query: toStaticQuery(config.sourceQuery),
      ...(config.invalidateQuery !== undefined ?
        { invalidateQuery: config.invalidateQuery }
      : {}),
    };
  }

  if (config.externalSource !== undefined) {
    return serializeExternalSource(config.externalSource);
  }

  throw new Error(
    "OlapDictionary: no source configured (unreachable after validation)",
  );
}

// ─── OlapDictionary class ─────────────────────────────────────────────────────

/**
 * Represents a ClickHouse Dictionary — an in-memory key-value store for fast
 * point lookups backed by a local ClickHouse table, a SQL query, or an
 * external data source (MySQL, PostgreSQL, HTTP, Redis, S3, etc.).
 *
 * Dictionaries are significantly faster than JOINs for repeated lookups of
 * static or slowly-changing reference data.
 *
 * @example
 * ```typescript
 * interface ProductLookup {
 *   ProductId: string;
 *   ProductName: string;
 *   PriceLevel: number & ClickHouseInt<"Int32">;
 * }
 *
 * export const ProductDict = new OlapDictionary<ProductLookup>("dict_products", {
 *   sourceTable: ProductsTable,
 *   primaryKey: ["ProductId"],
 *   layout: { type: "HASHED" },
 *   lifetime: 3600,
 * });
 *
 * // Use in a materialized view:
 * sql`SELECT ${ProductDict.get("ProductName", sql.raw("product_id"))} AS name FROM ...`
 * ```
 */
export class OlapDictionary<T> {
  /** @internal */
  public readonly kind = "OlapDictionary";

  /** Dictionary name */
  readonly name: string;

  /** User configuration */
  readonly config: OlapDictionaryConfig<T>;

  /** Compiler-injected columns (name + type from T) */
  readonly _columns: Column[];

  /** Serialized column list (DictionaryColumn JSON objects) */
  readonly serializedColumns: DictionaryColumnJson[];

  /**
   * Creates a new OlapDictionary.
   *
   * @param name - Dictionary name (used in ClickHouse DDL and dictGet calls)
   * @param config - Dictionary configuration
   */
  constructor(name: string, config: OlapDictionaryConfig<T>);

  /** @internal — compiler plugin injects schema and columns */
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
    this._columns = columns;

    // Validate: exactly one source must be set
    const sourcesSet = [
      config.sourceTable !== undefined,
      config.sourceQuery !== undefined,
      config.externalSource !== undefined,
    ].filter(Boolean).length;

    if (sourcesSet === 0) {
      throw new Error(
        `OlapDictionary '${name}': exactly one of sourceTable, sourceQuery, or externalSource must be set (none provided).`,
      );
    }
    if (sourcesSet > 1) {
      throw new Error(
        `OlapDictionary '${name}': exactly one of sourceTable, sourceQuery, or externalSource must be set (${sourcesSet} provided).`,
      );
    }

    // Validate: sourceQuery requires sourceTables
    if (config.sourceQuery !== undefined && !config.sourceTables?.length) {
      throw new Error(
        `OlapDictionary '${name}': sourceQuery requires sourceTables to be set for dependency tracking.`,
      );
    }
    if (config.sourceQuery !== undefined) {
      if (!toStaticQuery(config.sourceQuery).trim()) {
        throw new Error(
          `OlapDictionary '${name}': sourceQuery must not be blank.`,
        );
      }
    }

    // Validate: primaryKey count must match layout type
    if (!config.primaryKey.length) {
      throw new Error(
        `OlapDictionary '${name}': primaryKey must contain at least one column name.`,
      );
    }
    if (COMPLEX_KEY_LAYOUTS.has(config.layout.type)) {
      if (config.primaryKey.length < 2) {
        throw new Error(
          `OlapDictionary '${name}': layout '${config.layout.type}' requires at least 2 primary key columns (got ${config.primaryKey.length}).`,
        );
      }
    } else {
      if (config.primaryKey.length !== 1) {
        throw new Error(
          `OlapDictionary '${name}': layout '${config.layout.type}' requires exactly 1 primary key column (got ${config.primaryKey.length}). Use a COMPLEX_KEY_* layout for multi-column keys.`,
        );
      }
    }

    // Build serialized columns (name + typeString + per-column attributes)
    this.serializedColumns = buildDictionaryColumns(
      columns,
      config.columns as Record<string, DictionaryColumnConfig> | undefined,
    );

    // Capture source file from stack trace
    if (!config.metadata?.source) {
      const stack = new Error().stack;
      const sourceInfo = getSourceFileFromStack(stack);
      if (sourceInfo) {
        (this.config as any).metadata = {
          ...config.metadata,
          source: { file: sourceInfo },
        };
      }
    }

    // Register in the olapDictionaries registry
    const olapDictionaries = getMooseInternal().olapDictionaries;
    if (!isClientOnlyMode() && olapDictionaries.has(name)) {
      throw new Error(`OlapDictionary with name '${name}' already exists`);
    }
    olapDictionaries.set(name, this);
  }

  /**
   * Returns the qualified dictionary name for use in dictGet calls.
   * Format: `database.name` if database is set, otherwise just `name`.
   */
  getQualifiedName(): string {
    if (this.config.database) {
      return `${this.config.database}.${this.name}`;
    }
    return this.name;
  }

  /**
   * Formats key arguments for use in dictGet/dictHas SQL functions.
   * Strings are treated as SQL identifiers, numbers as literals.
   */
  private formatKeyArgs(keys: Array<Sql | string | number>): string {
    if (keys.length !== this.config.primaryKey.length) {
      throw new Error(
        `OlapDictionary '${this.name}': expected ${this.config.primaryKey.length} key argument(s) but got ${keys.length}.`,
      );
    }
    const parts = keys.map((k) => {
      if (typeof k === "object" && "strings" in k) {
        // Sql fragment — use toStaticQuery (throws if parameterized)
        return toStaticQuery(k as Sql);
      }
      if (typeof k === "string") {
        // Treat as a SQL identifier (column name); escape embedded backticks
        return `\`${k.replace(/`/g, "``")}\``;
      }
      return String(k);
    });
    return parts.length === 1 ? parts[0] : `(${parts.join(", ")})`;
  }

  /**
   * Generates a `dictGet('dict', 'attr', key)` SQL fragment.
   *
   * @param attr - The attribute (column) name to retrieve
   * @param keys - Key expression(s). Strings are treated as column identifiers.
   *
   * @example
   * ```typescript
   * sql`SELECT ${ProductDict.get("ProductName", "product_id")} AS name FROM ...`
   * // → SELECT dictGet('db.dict_products', 'ProductName', `product_id`) AS name FROM ...
   * ```
   */
  get(attr: keyof T & string, ...keys: Array<Sql | string | number>): Sql {
    if (!keys.length) {
      throw new Error(
        `OlapDictionary.get('${attr}'): at least one key argument is required.`,
      );
    }
    const qualifiedName = this.getQualifiedName().replace(/'/g, "''");
    const escapedAttr = (attr as string).replace(/'/g, "''");
    const keyExpr = this.formatKeyArgs(keys);
    return sql.raw(`dictGet('${qualifiedName}', '${escapedAttr}', ${keyExpr})`);
  }

  /**
   * Generates a `dictGetOrDefault('dict', 'attr', key, default)` SQL fragment.
   *
   * @param attr - The attribute (column) name to retrieve
   * @param defaultVal - The default value if the key is not found
   * @param keys - Key expression(s)
   */
  getOrDefault(
    attr: keyof T & string,
    defaultVal: Sql | string | number,
    ...keys: Array<Sql | string | number>
  ): Sql {
    if (!keys.length) {
      throw new Error(
        `OlapDictionary.getOrDefault('${attr}'): at least one key argument is required.`,
      );
    }
    const qualifiedName = this.getQualifiedName().replace(/'/g, "''");
    const escapedAttr = (attr as string).replace(/'/g, "''");
    const keyExpr = this.formatKeyArgs(keys);
    let defaultExpr: string;
    if (typeof defaultVal === "object" && "strings" in defaultVal) {
      defaultExpr = toStaticQuery(defaultVal as Sql);
    } else if (typeof defaultVal === "string") {
      defaultExpr = `'${defaultVal.replace(/'/g, "''")}'`;
    } else {
      defaultExpr = String(defaultVal);
    }
    return sql.raw(
      `dictGetOrDefault('${qualifiedName}', '${escapedAttr}', ${keyExpr}, ${defaultExpr})`,
    );
  }

  /**
   * Generates a `dictHas('dict', key)` SQL fragment.
   *
   * @param keys - Key expression(s)
   *
   * @example
   * ```typescript
   * sql`SELECT * FROM source WHERE ${ProductDict.has("product_id")}`
   * // → SELECT * FROM source WHERE dictHas('db.dict_products', `product_id`)
   * ```
   */
  has(...keys: Array<Sql | string | number>): Sql {
    if (!keys.length) {
      throw new Error(
        `OlapDictionary.has(): at least one key argument is required.`,
      );
    }
    const qualifiedName = this.getQualifiedName().replace(/'/g, "''");
    const keyExpr = this.formatKeyArgs(keys);
    return sql.raw(`dictHas('${qualifiedName}', ${keyExpr})`);
  }

  /**
   * Serializes this dictionary to the JSON format expected by the Rust CLI.
   * @internal
   */
  toJson(): Record<string, unknown> {
    const source = serializeSource(this.config);

    const result: Record<string, unknown> = {
      name: this.name,
      source,
      primaryKey: this.config.primaryKey,
      columns: this.serializedColumns,
      layout: serializeLayout(this.config.layout),
      lifetime: serializeLifetime(this.config.lifetime),
      settings: this.config.settings ?? {},
      lifeCycle: this.config.lifeCycle ?? LifeCycle.FULLY_MANAGED,
    };

    if (this.config.database !== undefined)
      result.database = this.config.database;
    if (this.config.clusterName !== undefined)
      result.clusterName = this.config.clusterName;
    if (this.config.invalidateQuery !== undefined)
      result.invalidateQuery = this.config.invalidateQuery;
    if (this.config.comment !== undefined) result.comment = this.config.comment;
    if (this.config.metadata !== undefined)
      result.metadata = this.config.metadata;

    return result;
  }
}
