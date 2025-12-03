import ts from "typescript";
import { IdentifierBrandedString } from "../sqlHelpers";

export type EnumValues =
  | { name: string; value: { Int: number } }[]
  | { name: string; value: { String: string } }[];
export type DataEnum = { name: string; values: EnumValues };
export type Nested = { name: string; columns: Column[]; jwt: boolean };
export type ArrayType = { elementType: DataType; elementNullable: boolean };
export type NamedTupleType = { fields: Array<[string, DataType]> };
export type MapType = { keyType: DataType; valueType: DataType };
export type JsonOptions = {
  max_dynamic_paths?: number;
  max_dynamic_types?: number;
  typed_paths?: Array<[string, DataType]>;
  skip_paths?: string[];
  skip_regexps?: string[];
};
export type DataType =
  | string
  | DataEnum
  | ArrayType
  | Nested
  | NamedTupleType
  | MapType
  | JsonOptions
  | { nullable: DataType };
export interface Column {
  name: IdentifierBrandedString;
  data_type: DataType;
  required: boolean;
  unique: false; // what is this for?
  primary_key: boolean;
  default: string | null;
  materialized: string | null;
  ttl: string | null;
  codec: string | null;
  annotations: [string, any][];
}

export interface DataModel {
  columns: Column[];
  name: string;
}

export class UnknownType extends Error {
  t: ts.Type;
  fieldName: string;
  typeName: string;
  constructor(t: ts.Type, fieldName: string, typeName: string) {
    super();
    this.t = t;
    this.fieldName = fieldName;
    this.typeName = typeName;
  }
}

export class NullType extends Error {
  fieldName: string;
  typeName: string;
  constructor(fieldName: string, typeName: string) {
    super();
    this.fieldName = fieldName;
    this.typeName = typeName;
  }
}

export class UnsupportedEnum extends Error {
  enumName: string;
  constructor(enumName: string) {
    super();
    this.enumName = enumName;
  }
}

export class UnsupportedFeature extends Error {
  featureName: string;
  constructor(featureName: string) {
    super();
    this.featureName = featureName;
  }
}

export class IndexType extends Error {
  typeName: string;
  indexSignatures: string[];

  constructor(typeName: string, indexSignatures: string[]) {
    const explanation =
      "Index signatures (e.g. [key: string]: value) are not supported in data models.";

    const suggestion =
      "Consider splitting this into separate types or using a single Record<K, V> type.";

    const signatures = `Found index signatures: ${indexSignatures.join(", ")}`;

    super(
      `${explanation}\n\nType: ${typeName}\n\n${signatures}\n\nSuggestion: ${suggestion}`,
    );

    this.typeName = typeName;
    this.indexSignatures = indexSignatures;
  }
}

/**
 * Type guard: is this DataType an Array(Nested(...))?
 * Uses the ArrayType and Nested types for type safety.
 */
export function isArrayNestedType(
  dt: DataType,
): dt is ArrayType & { elementType: Nested } {
  return (
    typeof dt === "object" &&
    dt !== null &&
    (dt as ArrayType).elementType !== null &&
    typeof (dt as ArrayType).elementType === "object" &&
    (dt as ArrayType).elementType.hasOwnProperty("columns") &&
    Array.isArray(((dt as ArrayType).elementType as Nested).columns)
  );
}

/**
 * Type guard: is this DataType a Nested struct (not array)?
 */
export function isNestedType(dt: DataType): dt is Nested {
  return (
    typeof dt === "object" &&
    dt !== null &&
    Array.isArray((dt as Nested).columns)
  );
}
