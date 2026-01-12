// source https://github.com/blakeembrey/sql-template-tag/blob/main/src/index.ts
import { Column } from "./dataModels/dataModelTypes";
import { OlapTable, View } from "./dmv2";

import { AggregationFunction } from "./dataModels/typeConvert";

/**
 * Quote a ClickHouse identifier with backticks if not already quoted.
 * Backticks allow special characters (e.g., hyphens) in identifiers.
 */
export const quoteIdentifier = (name: string): string => {
  return name.startsWith("`") && name.endsWith("`") ? name : `\`${name}\``;
};

const isTable = (
  value: RawValue | Column | OlapTable<any> | View,
): value is OlapTable<any> =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  value.kind === "OlapTable";

const isView = (
  value: RawValue | Column | OlapTable<any> | View,
): value is View =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  value.kind === "View";

export type IdentifierBrandedString = string & {
  readonly __identifier_brand?: unique symbol;
};
export type NonIdentifierBrandedString = string & {
  readonly __identifier_brand?: unique symbol;
};

/**
 * Values supported by SQL engine.
 */
export type Value =
  | NonIdentifierBrandedString
  | number
  | boolean
  | Date
  | [string, string];

/**
 * Supported value or SQL instance.
 */
export type RawValue = Value | Sql;

const isColumn = (
  value: RawValue | Column | OlapTable<any> | View,
): value is Column =>
  typeof value === "object" &&
  value !== null &&
  !("kind" in value) &&
  "name" in value &&
  "annotations" in value;

/**
 * Sql template tag interface with attached helper methods.
 */
export interface SqlTemplateTag {
  (
    strings: readonly string[],
    ...values: readonly (RawValue | Column | OlapTable<any>)[]
  ): Sql;

  /**
   * Join an array of Sql fragments with a separator.
   * @param fragments - Array of Sql fragments to join
   * @param separator - Optional separator string (defaults to ", ")
   */
  join(fragments: Sql[], separator?: string): Sql;

  /**
   * Create raw SQL from a string without parameterization.
   * WARNING: SQL injection risk if used with untrusted input.
   */
  raw(text: string): Sql;
}

function sqlImpl(
  strings: readonly string[],
  ...values: readonly (RawValue | Column | OlapTable<any> | View)[]
) {
  return new Sql(strings, values);
}

export const sql: SqlTemplateTag = sqlImpl as SqlTemplateTag;

const instanceofSql = (
  value: RawValue | Column | OlapTable<any> | View,
): value is Sql =>
  typeof value === "object" && "values" in value && "strings" in value;

/**
 * A SQL instance can be nested within each other to build SQL strings.
 */
export class Sql {
  readonly values: Value[];
  readonly strings: string[];

  constructor(
    rawStrings: readonly string[],
    rawValues: readonly (RawValue | Column | OlapTable<any> | View)[],
  ) {
    if (rawStrings.length - 1 !== rawValues.length) {
      if (rawStrings.length === 0) {
        throw new TypeError("Expected at least 1 string");
      }

      throw new TypeError(
        `Expected ${rawStrings.length} strings to have ${
          rawStrings.length - 1
        } values`,
      );
    }

    const valuesLength = rawValues.reduce<number>(
      (len: number, value: RawValue | Column | OlapTable<any> | View) =>
        len +
        (instanceofSql(value) ? value.values.length
        : isColumn(value) || isTable(value) || isView(value) ? 0
        : 1),
      0,
    );

    this.values = new Array(valuesLength);
    this.strings = new Array(valuesLength + 1);

    this.strings[0] = rawStrings[0];

    // Iterate over raw values, strings, and children. The value is always
    // positioned between two strings, e.g. `index + 1`.
    let i = 0,
      pos = 0;
    while (i < rawValues.length) {
      const child = rawValues[i++];
      const rawString = rawStrings[i];

      // Check for nested `sql` queries.
      if (instanceofSql(child)) {
        // Append child prefix text to current string.
        this.strings[pos] += child.strings[0];

        let childIndex = 0;
        while (childIndex < child.values.length) {
          this.values[pos++] = child.values[childIndex++];
          this.strings[pos] = child.strings[childIndex];
        }

        // Append raw string to current string.
        this.strings[pos] += rawString;
      } else if (isColumn(child)) {
        const aggregationFunction = child.annotations.find(
          ([k, _]) => k === "aggregationFunction",
        );
        if (aggregationFunction !== undefined) {
          this.strings[pos] +=
            `${(aggregationFunction[1] as AggregationFunction).functionName}Merge(\`${child.name}\`)`;
        } else {
          this.strings[pos] += `\`${child.name}\``;
        }
        this.strings[pos] += rawString;
      } else if (isTable(child)) {
        if (child.config.database) {
          this.strings[pos] += `\`${child.config.database}\`.\`${child.name}\``;
        } else {
          this.strings[pos] += `\`${child.name}\``;
        }
        this.strings[pos] += rawString;
      } else if (isView(child)) {
        this.strings[pos] += `\`${child.name}\``;
        this.strings[pos] += rawString;
      } else {
        this.values[pos++] = child;
        this.strings[pos] = rawString;
      }
    }
  }

  /**
   * Append another Sql fragment, returning a new Sql instance.
   */
  append(other: Sql): Sql {
    return new Sql([...this.strings, ""], [...this.values, other]);
  }
}

sql.join = function (fragments: Sql[], separator?: string): Sql {
  if (fragments.length === 0) return new Sql([""], []);
  if (fragments.length === 1) return fragments[0];
  const sep = separator ?? ", ";
  const normalized = sep.includes(" ") ? sep : ` ${sep} `;
  const strings = ["", ...Array(fragments.length - 1).fill(normalized), ""];
  return new Sql(strings, fragments);
};

sql.raw = function (text: string): Sql {
  return new Sql([text], []);
};

export const toStaticQuery = (sql: Sql): string => {
  const [query, params] = toQuery(sql);
  if (Object.keys(params).length !== 0) {
    throw new Error(
      "Dynamic SQL is not allowed in the select statement in view creation.",
    );
  }
  return query;
};

export const toQuery = (sql: Sql): [string, { [pN: string]: any }] => {
  const parameterizedStubs = sql.values.map((v, i) =>
    createClickhouseParameter(i, v),
  );

  const query = sql.strings
    .map((s, i) =>
      s != "" ? `${s}${emptyIfUndefined(parameterizedStubs[i])}` : "",
    )
    .join("");

  const query_params = sql.values.reduce(
    (acc: Record<string, unknown>, v, i) => ({
      ...acc,
      [`p${i}`]: getValueFromParameter(v),
    }),
    {},
  );
  return [query, query_params];
};

/**
 * Build a display-only SQL string with values inlined for logging/debugging.
 * Does not alter execution behavior; use toQuery for actual execution.
 */
export const toQueryPreview = (sql: Sql): string => {
  try {
    const formatValue = (v: Value): string => {
      // Unwrap identifiers: ["Identifier", name]
      if (Array.isArray(v)) {
        const [type, val] = v as unknown as [string, any];
        if (type === "Identifier") {
          // Quote identifiers with backticks like other helpers
          return `\`${String(val)}\``;
        }
        // Fallback for unexpected arrays
        return `[${(v as unknown as any[]).map((x) => formatValue(x as Value)).join(", ")}]`;
      }
      if (v === null || v === undefined) return "NULL";
      if (typeof v === "string") return `'${v.replace(/'/g, "''")}'`;
      if (typeof v === "number") return String(v);
      if (typeof v === "boolean") return v ? "true" : "false";
      if (v instanceof Date)
        return `'${v.toISOString().replace("T", " ").slice(0, 19)}'`;
      try {
        return JSON.stringify(v as unknown as any);
      } catch {
        return String(v);
      }
    };

    let out = sql.strings[0] ?? "";
    for (let i = 0; i < sql.values.length; i++) {
      const val = getValueFromParameter(sql.values[i] as any);
      out += formatValue(val as Value);
      out += sql.strings[i + 1] ?? "";
    }
    return out.replace(/\s+/g, " ").trim();
  } catch (error) {
    console.log(`toQueryPreview error: ${error}`);
    return "/* query preview unavailable */";
  }
};

export const getValueFromParameter = (value: any) => {
  if (Array.isArray(value)) {
    const [type, val] = value;
    if (type === "Identifier") return val;
  }
  return value;
};
export function createClickhouseParameter(
  parameterIndex: number,
  value: Value,
) {
  // ClickHouse use {name:type} be a placeholder, so if we only use number string as name e.g: {1:Unit8}
  // it will face issue when converting to the query params => {1: value1}, because the key is value not string type, so here add prefix "p" to avoid this issue.
  return `{p${parameterIndex}:${mapToClickHouseType(value)}}`;
}

/**
 * Convert the JS type (source is JSON format by API query parameter) to the corresponding ClickHouse type for generating named placeholder of parameterized query.
 * Only support to convert number to Int or Float, boolean to Bool, string to String, other types will convert to String.
 * If exist complex type e.g: object, Array, null, undefined, Date, Record.. etc, just convert to string type by ClickHouse function in SQL.
 * ClickHouse support converting string to other types function.
 * Please see Each section of the https://clickhouse.com/docs/en/sql-reference/functions and https://clickhouse.com/docs/en/sql-reference/functions/type-conversion-functions
 * @param value
 * @returns 'Float', 'Int', 'Bool', 'String'
 */
export const mapToClickHouseType = (value: Value) => {
  if (typeof value === "number") {
    // infer the float or int according to exist remainder or not
    return Number.isInteger(value) ? "Int" : "Float";
  }
  // When define column type or query result with parameterized query, The Bool or Boolean type both supported.
  // But the column type of query result only return Bool, so we only support Bool type for safety.
  if (typeof value === "boolean") return "Bool";
  if (value instanceof Date) return "DateTime";
  if (Array.isArray(value)) {
    const [type, _] = value;
    return type;
  }
  return "String";
};
function emptyIfUndefined(value: string | undefined): string {
  return value === undefined ? "" : value;
}
