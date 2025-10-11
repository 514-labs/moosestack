import { Pattern, TagBase } from "typia/lib/tags";
import { tags } from "typia";

export type ClickHousePrecision<P extends number> = {
  _clickhouse_precision?: P;
};

export const DecimalRegex: "^-?\\d+(\\.\\d+)?$" = "^-?\\d+(\\.\\d+)?$";

export type ClickHouseDecimal<P extends number, S extends number> = {
  _clickhouse_precision?: P;
  _clickhouse_scale?: S;
} & Pattern<typeof DecimalRegex>;

export type ClickHouseByteSize<N extends number> = {
  _clickhouse_byte_size?: N;
};

export type LowCardinality = {
  _LowCardinality?: true;
};

// ClickHouse-friendly helper aliases for clarity in user schemas
// These are erased at compile time but guide the ClickHouse mapping logic.
export type DateTime = Date;
export type DateTime64<P extends number> = Date & ClickHousePrecision<P>;

// Numeric convenience tags mirroring ClickHouse integer and float families
export type Float32 = number & ClickHouseFloat<"float32">;
export type Float64 = number & ClickHouseFloat<"float64">;

export type Int8 = number & ClickHouseInt<"int8">;
export type Int16 = number & ClickHouseInt<"int16">;
export type Int32 = number & ClickHouseInt<"int32">;
export type Int64 = number & ClickHouseInt<"int64">;

export type UInt8 = number & ClickHouseInt<"uint8">;
export type UInt16 = number & ClickHouseInt<"uint16">;
export type UInt32 = number & ClickHouseInt<"uint32">;
export type UInt64 = number & ClickHouseInt<"uint64">;

// Decimal(P, S) annotation
export type Decimal<P extends number, S extends number> = string &
  ClickHouseDecimal<P, S>;

export type ClickHouseFloat<Value extends "float32" | "float64"> = tags.Type<
  Value extends "float32" ? "float" : "double"
>;

export type ClickHouseInt<
  Value extends
    | "int8"
    | "int16"
    | "int32"
    | "int64"
    // | "int128"
    // | "int256"
    | "uint8"
    | "uint16"
    | "uint32"
    | "uint64",
  // | "uint128"
  // | "uint256",
> =
  Value extends "int32" | "int64" | "uint32" | "uint64" ? tags.Type<Value>
  : TagBase<{
      target: "number";
      kind: "type";
      value: Value;
      validate: Value extends "int8" ? "-128 <= $input && $input <= 127"
      : Value extends "int16" ? "-32768 <= $input && $input <= 32767"
      : Value extends "uint8" ? "0 <= $input && $input <= 255"
      : Value extends "uint16" ? "0 <= $input && $input <= 65535"
      : never;
      exclusive: true;
      schema: {
        type: "integer";
      };
    }>;

/**
 * By default, nested objects map to the `Nested` type in clickhouse.
 * Write `nestedObject: AnotherInterfaceType & ClickHouseNamedTuple`
 * to map AnotherInterfaceType to the named tuple type.
 */
export type ClickHouseNamedTuple = {
  _clickhouse_mapped_type?: "namedTuple";
};

/**
 * typia may have trouble handling this type.
 * In which case, use {@link WithDefault} as a workaround
 *
 * @example
 * { field: number & ClickHouseDefault<"0"> }
 */
export type ClickHouseDefault<SqlExpression extends string> = {
  _clickhouse_default?: SqlExpression;
};

/**
 * @example
 * {
 *   ...
 *   timestamp: Date;
 *   debugMessage: string & ClickHouseTTL<"timestamp + INTERVAL 1 WEEK">;
 * }
 */
export type ClickHouseTTL<SqlExpression extends string> = {
  _clickhouse_ttl?: SqlExpression;
};

/**
 * See also {@link ClickHouseDefault}
 *
 * @example{ updated_at: WithDefault<Date, "now()"> }
 */
export type WithDefault<T, _SqlExpression extends string> = T;
