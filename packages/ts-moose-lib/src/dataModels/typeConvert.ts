import ts, {
  isIdentifier,
  isTypeReferenceNode,
  SymbolFlags,
  TupleType,
  TypeChecker,
  TypeFlags,
} from "typescript";
import { enumConvert, isEnum } from "./enumConvert";
import {
  ArrayType,
  Column,
  DataType,
  DataEnum,
  Nested,
  NamedTupleType,
  NullType,
  UnknownType,
  UnsupportedFeature,
  IndexType,
  MapType,
} from "./dataModelTypes";
import { ClickHouseNamedTuple, DecimalRegex } from "./types";
import { STRING_DATE_ANNOTATION } from "../utilities/json";

const dateType = (checker: TypeChecker) =>
  checker
    .getTypeOfSymbol(
      checker.resolveName("Date", undefined, SymbolFlags.Type, false)!,
    )
    .getConstructSignatures()[0]
    .getReturnType();

// making throws expressions so that they can be used in ternaries

const throwUnknownType = (
  t: ts.Type,
  fieldName: string,
  typeName: string,
): never => {
  throw new UnknownType(t, fieldName, typeName);
};

const throwNullType = (fieldName: string, typeName: string): never => {
  throw new NullType(fieldName, typeName);
};

const throwIndexTypeError = (t: ts.Type, checker: TypeChecker): never => {
  const interfaceName = t.symbol?.name || "unknown type";
  const indexInfos = checker.getIndexInfosOfType(t);
  const signatures = indexInfos.map((info) => {
    const keyType = checker.typeToString(info.keyType);
    const valueType = checker.typeToString(info.type);
    return `[${keyType}]: ${valueType}`;
  });

  throw new IndexType(interfaceName, signatures);
};

/** Recursively search for a property on a type, traversing intersections */
const getPropertyDeep = (t: ts.Type, name: string): ts.Symbol | undefined => {
  const direct = t.getProperty(name);
  if (direct !== undefined) return direct;
  // TODO: investigate if this logic is needed.
  //  the properties in types in intersection should be reachable by t.getProperty
  // Intersection constituents may carry the marker symbols
  if (t.isIntersection()) {
    for (const sub of t.types) {
      const found = getPropertyDeep(sub, name);
      if (found) return found;
    }
  }
  return undefined;
};

const toArrayType = ([elementNullable, _, elementType]: [
  boolean,
  [string, any][],
  DataType,
]): ArrayType => {
  return {
    elementNullable,
    elementType,
  };
};

const isNumberType = (t: ts.Type, checker: TypeChecker): boolean => {
  return checker.isTypeAssignableTo(t, checker.getNumberType());
};

const handleAggregated = (
  t: ts.Type,
  checker: TypeChecker,
  fieldName: string,
  typeName: string,
): AggregationFunction | undefined => {
  const functionSymbol = t.getProperty("_aggregationFunction");
  const argsTypesSymbol = t.getProperty("_argTypes");

  if (functionSymbol === undefined || argsTypesSymbol === undefined) {
    return undefined;
  }
  const functionStringLiteral = checker.getNonNullableType(
    checker.getTypeOfSymbol(functionSymbol),
  );
  const types = checker.getNonNullableType(
    checker.getTypeOfSymbol(argsTypesSymbol),
  );

  if (functionStringLiteral.isStringLiteral() && checker.isTupleType(types)) {
    const argumentTypes = ((types as TupleType).typeArguments || []).map(
      (argT) => {
        return tsTypeToDataType(argT, checker, fieldName, typeName, false)[2];
      },
    );
    return { functionName: functionStringLiteral.value, argumentTypes };
  } else {
    console.log(
      "[CompilerPlugin] Unexpected type inside Aggregated",
      functionStringLiteral,
    );
    return undefined;
  }
};

const getTaggedType = (
  t: ts.Type,
  checker: TypeChecker,
  propertyName: string,
): ts.Type | null => {
  // Ensure we check the non-nullable part so the tag property is there
  const nonNull = t.getNonNullableType();
  const ttlSymbol = nonNull.getProperty(propertyName);
  if (ttlSymbol === undefined) return null;
  return checker.getNonNullableType(checker.getTypeOfSymbol(ttlSymbol));
};

// JSON mapping: recognize SomeInterface & ClickHouseJson<...>
const getJsonMappedType = (
  t: ts.Type,
  checker: TypeChecker,
): DataType | null => {
  const mappingSymbol = getPropertyDeep(t, "_clickhouse_mapped_type");
  if (mappingSymbol === undefined) return null;
  const mappedType = checker.getNonNullableType(
    checker.getTypeOfSymbol(mappingSymbol),
  );
  if (!mappedType.isStringLiteral() || mappedType.value !== "JSON") {
    return null;
  }

  // Extract settings from the type properties
  let maxDynamicPaths: number | undefined = undefined;
  let maxDynamicTypes: number | undefined = undefined;
  let skipPaths: string[] = [];
  let skipRegexes: string[] = [];

  const settingsSymbol = getPropertyDeep(t, "_clickhouse_json_settings");
  if (settingsSymbol !== undefined) {
    const settingsType = checker.getNonNullableType(
      checker.getTypeOfSymbol(settingsSymbol),
    );

    const maxPathsSymbol = getPropertyDeep(settingsType, "maxDynamicPaths");
    if (maxPathsSymbol !== undefined) {
      const maxPathsType = checker.getNonNullableType(
        checker.getTypeOfSymbol(maxPathsSymbol),
      );
      if (maxPathsType.isNumberLiteral()) {
        maxDynamicPaths = maxPathsType.value;
      }
    }

    const maxTypesSymbol = getPropertyDeep(settingsType, "maxDynamicTypes");
    if (maxTypesSymbol !== undefined) {
      const maxTypesType = checker.getNonNullableType(
        checker.getTypeOfSymbol(maxTypesSymbol),
      );
      if (maxTypesType.isNumberLiteral()) {
        maxDynamicTypes = maxTypesType.value;
      }
    }

    const skipPathsSymbol = getPropertyDeep(settingsType, "skipPaths");
    if (skipPathsSymbol !== undefined) {
      const skipPathsType = checker.getNonNullableType(
        checker.getTypeOfSymbol(skipPathsSymbol),
      );
      if (checker.isTupleType(skipPathsType)) {
        const tuple = skipPathsType as TupleType;
        skipPaths = (tuple.typeArguments || [])
          .filter((t) => t.isStringLiteral())
          .map((t) => (t as ts.StringLiteralType).value);
      }
    }

    const skipRegexesSymbol = getPropertyDeep(settingsType, "skipRegexes");
    if (skipRegexesSymbol !== undefined) {
      const skipRegexesType = checker.getNonNullableType(
        checker.getTypeOfSymbol(skipRegexesSymbol),
      );
      if (checker.isTupleType(skipRegexesType)) {
        const tuple = skipRegexesType as TupleType;
        skipRegexes = (tuple.typeArguments || [])
          .filter((t) => t.isStringLiteral())
          .map((t) => (t as ts.StringLiteralType).value);
      }
    }
  }

  // For typed paths, try to find the interface part of the intersection
  let base: ts.Type = t.getNonNullableType();
  if (base.isIntersection()) {
    const candidates = base.types.filter((sub) => {
      const m = getPropertyDeep(sub, "_clickhouse_mapped_type");
      if (!m) return true;
      const mt = checker.getNonNullableType(checker.getTypeOfSymbol(m));
      return !(mt.isStringLiteral() && mt.value === "JSON");
    });
    if (candidates.length > 0) base = candidates[0];
  }

  // Build typed paths from the base interface's columns (top-level only)
  let typedPaths: Array<[string, DataType]> = [];
  try {
    const cols = toColumns(base, checker);
    typedPaths = cols.map((c) => [c.name, c.data_type]);
  } catch (_) {
    // Fallback silently if we cannot derive columns
    typedPaths = [];
  }

  const hasAnyOption =
    typeof maxDynamicPaths === "number" ||
    typeof maxDynamicTypes === "number" ||
    typedPaths.length > 0 ||
    skipPaths.length > 0 ||
    skipRegexes.length > 0;

  if (!hasAnyOption) return "Json";

  const result: Record<string, any> = {
    typed_paths: typedPaths,
    skip_paths: skipPaths,
    skip_regexps: skipRegexes,
  };

  // Only include these fields if they have actual values
  if (typeof maxDynamicPaths === "number") {
    result.max_dynamic_paths = maxDynamicPaths;
  }
  if (typeof maxDynamicTypes === "number") {
    result.max_dynamic_types = maxDynamicTypes;
  }

  return result as unknown as DataType;
};

const handleSimpleAggregated = (
  t: ts.Type,
  checker: TypeChecker,
  fieldName: string,
  typeName: string,
): SimpleAggregationFunction | undefined => {
  const functionSymbol = t.getProperty("_simpleAggregationFunction");
  const argTypeSymbol = t.getProperty("_argType");

  if (functionSymbol === undefined || argTypeSymbol === undefined) {
    return undefined;
  }
  const functionStringLiteral = checker.getNonNullableType(
    checker.getTypeOfSymbol(functionSymbol),
  );
  const argType = checker.getNonNullableType(
    checker.getTypeOfSymbol(argTypeSymbol),
  );

  if (functionStringLiteral.isStringLiteral()) {
    const argumentType = tsTypeToDataType(
      argType,
      checker,
      fieldName,
      typeName,
      false,
    )[2];
    return { functionName: functionStringLiteral.value, argumentType };
  } else {
    console.log(
      "[CompilerPlugin] Unexpected type inside SimpleAggregated",
      functionStringLiteral,
    );
    return undefined;
  }
};
/** Detect ClickHouse default annotation on a type and return raw sql */
const handleDefault = (t: ts.Type, checker: TypeChecker): string | null => {
  const defaultType = getTaggedType(t, checker, "_clickhouse_default");
  if (defaultType === null) {
    return null;
  }
  if (!defaultType.isStringLiteral()) {
    throw new UnsupportedFeature(
      'ClickHouseDefault must use a string literal, e.g. ClickHouseDefault<"now()">',
    );
  }
  return defaultType.value;
};

/** Detect ClickHouse TTL annotation on a type and return raw sql */
const handleTtl = (t: ts.Type, checker: TypeChecker): string | null => {
  const ttlType = getTaggedType(t, checker, "_clickhouse_ttl");
  if (ttlType === null) {
    return null;
  }
  if (!ttlType.isStringLiteral()) {
    throw new UnsupportedFeature(
      'ClickHouseTTL must use a string literal, e.g. ClickHouseTTL<"timestamp + INTERVAL 1 WEEK">',
    );
  }
  return ttlType.value;
};

const handleNumberType = (
  t: ts.Type,
  checker: TypeChecker,
  fieldName: string,
): string => {
  // Detect Decimal(P, S) annotation on number via ClickHouseDecimal
  const decimalPrecisionSymbol = getPropertyDeep(t, "_clickhouse_precision");
  const decimalScaleSymbol = getPropertyDeep(t, "_clickhouse_scale");
  if (
    decimalPrecisionSymbol !== undefined &&
    decimalScaleSymbol !== undefined
  ) {
    const precisionType = checker.getNonNullableType(
      checker.getTypeOfSymbol(decimalPrecisionSymbol),
    );
    const scaleType = checker.getNonNullableType(
      checker.getTypeOfSymbol(decimalScaleSymbol),
    );
    if (precisionType.isNumberLiteral() && scaleType.isNumberLiteral()) {
      return `Decimal(${precisionType.value}, ${scaleType.value})`;
    }
  }

  const tagSymbol = t.getProperty("typia.tag");
  if (tagSymbol === undefined) {
    return "Float64";
  } else {
    const typiaProps = checker.getNonNullableType(
      checker.getTypeOfSymbol(tagSymbol),
    );
    const props: ts.Type[] =
      typiaProps.isIntersection() ? typiaProps.types : [typiaProps];

    for (const prop of props) {
      const valueSymbol = prop.getProperty("value");
      if (valueSymbol === undefined) {
        console.log(
          `[CompilerPlugin] Props.value is undefined for ${fieldName}`,
        );
      } else {
        const valueTypeLiteral = checker.getTypeOfSymbol(valueSymbol);
        const numberTypeMappings = {
          float: "Float32",
          double: "Float64",
          int8: "Int8",
          int16: "Int16",
          int32: "Int32",
          int64: "Int64",
          uint8: "UInt8",
          uint16: "UInt16",
          uint32: "UInt32",
          uint64: "UInt64",
        };
        const match = Object.entries(numberTypeMappings).find(([k, _]) =>
          isStringLiteral(valueTypeLiteral, checker, k),
        );
        if (match) {
          return match[1];
        } else {
          const typeString =
            valueTypeLiteral.isStringLiteral() ?
              valueTypeLiteral.value
            : "unknown";

          console.log(
            `[CompilerPlugin] Other number types are not supported: ${typeString} in field ${fieldName}`,
          );
        }
      }
    }

    return "Float64";
  }
};

export interface AggregationFunction {
  functionName: string;
  argumentTypes: DataType[];
}

export interface SimpleAggregationFunction {
  functionName: string;
  argumentType: DataType;
}

const isStringLiteral = (
  t: ts.Type,
  checker: TypeChecker,
  lit: string,
): boolean => checker.isTypeAssignableTo(t, checker.getStringLiteralType(lit));

const handleStringType = (
  t: ts.Type,
  checker: TypeChecker,
  fieldName: string,
  annotations: [string, any][],
): string => {
  // Check for FixedString(N) annotation
  const fixedStringSizeSymbol = getPropertyDeep(
    t,
    "_clickhouse_fixed_string_size",
  );
  if (fixedStringSizeSymbol !== undefined) {
    const sizeType = checker.getNonNullableType(
      checker.getTypeOfSymbol(fixedStringSizeSymbol),
    );
    if (sizeType.isNumberLiteral()) {
      return `FixedString(${sizeType.value})`;
    }
  }

  const tagSymbol = t.getProperty("typia.tag");
  if (tagSymbol === undefined) {
    if (t.isUnion() && t.types.every((v) => v.isStringLiteral())) {
      annotations.push(["LowCardinality", true]);
    }

    return "String";
  } else {
    const typiaProps = checker.getNonNullableType(
      checker.getTypeOfSymbol(tagSymbol),
    );
    const props: ts.Type[] =
      typiaProps.isIntersection() ? typiaProps.types : [typiaProps];

    for (const prop of props) {
      const valueSymbol = prop.getProperty("value");
      if (valueSymbol === undefined) {
        console.log(
          `[CompilerPlugin] Props.value is undefined for ${fieldName}`,
        );
      } else {
        const valueTypeLiteral = checker.getTypeOfSymbol(valueSymbol);
        if (isStringLiteral(valueTypeLiteral, checker, "uuid")) {
          return "UUID";
        } else if (isStringLiteral(valueTypeLiteral, checker, "date-time")) {
          let precision = 9;

          const precisionSymbol = t.getProperty("_clickhouse_precision");
          if (precisionSymbol !== undefined) {
            const precisionType = checker.getNonNullableType(
              checker.getTypeOfSymbol(precisionSymbol),
            );
            if (precisionType.isNumberLiteral()) {
              precision = precisionType.value;
            }
          }
          // Mark this as a string-based date field so it won't be parsed to Date at runtime
          annotations.push([STRING_DATE_ANNOTATION, true]);
          return `DateTime(${precision})`;
        } else if (isStringLiteral(valueTypeLiteral, checker, "date")) {
          let size = 4;
          const sizeSymbol = t.getProperty("_clickhouse_byte_size");
          if (sizeSymbol !== undefined) {
            const sizeType = checker.getNonNullableType(
              checker.getTypeOfSymbol(sizeSymbol),
            );
            if (sizeType.isNumberLiteral()) {
              size = sizeType.value;
            }
          }

          if (size === 4) {
            return "Date";
          } else if (size === 2) {
            return "Date16";
          } else {
            throw new UnsupportedFeature(`Date with size ${size}`);
          }
        } else if (isStringLiteral(valueTypeLiteral, checker, "ipv4")) {
          return "IPv4";
        } else if (isStringLiteral(valueTypeLiteral, checker, "ipv6")) {
          return "IPv6";
        } else if (isStringLiteral(valueTypeLiteral, checker, DecimalRegex)) {
          let precision = 10;
          let scale = 0;

          const precisionSymbol = t.getProperty("_clickhouse_precision");
          if (precisionSymbol !== undefined) {
            const precisionType = checker.getNonNullableType(
              checker.getTypeOfSymbol(precisionSymbol),
            );
            if (precisionType.isNumberLiteral()) {
              precision = precisionType.value;
            }
          }

          const scaleSymbol = t.getProperty("_clickhouse_scale");
          if (scaleSymbol !== undefined) {
            const scaleType = checker.getNonNullableType(
              checker.getTypeOfSymbol(scaleSymbol),
            );
            if (scaleType.isNumberLiteral()) {
              scale = scaleType.value;
            }
          }

          return `Decimal(${precision}, ${scale})`;
        } else {
          const typeString =
            valueTypeLiteral.isStringLiteral() ?
              valueTypeLiteral.value
            : "unknown";

          console.log(
            `[CompilerPlugin] Unknown format: ${typeString} in field ${fieldName}`,
          );
        }
      }
    }

    return "String";
  }
};

const isStringAnyRecord = (t: ts.Type, checker: ts.TypeChecker): boolean => {
  const indexInfos = checker.getIndexInfosOfType(t);
  if (indexInfos && indexInfos.length === 1) {
    const indexInfo = indexInfos[0];
    return (
      indexInfo.keyType == checker.getStringType() &&
      indexInfo.type == checker.getAnyType()
    );
  }

  return false;
};

/**
 * Check if a type is a Record<K, V> type (generic map/dictionary type)
 */
const isRecordType = (t: ts.Type, checker: ts.TypeChecker): boolean => {
  const indexInfos = checker.getIndexInfosOfType(t);
  return indexInfos && indexInfos.length === 1;
};

/**
 * Detects a tag-like object type that only carries metadata, e.g. { _tag: ... }
 */
const isSingleUnderscoreMetaObject = (
  t: ts.Type,
  checker: ts.TypeChecker,
): boolean => {
  const props = checker.getPropertiesOfType(t);
  if (props.length !== 1) return false;
  const onlyProp = props[0];
  const name = onlyProp.name;
  return typeof name === "string" && name.startsWith("_");
};

/**
 * Handle Record<K, V> types and convert them to Map types
 */
const handleRecordType = (
  t: ts.Type,
  checker: ts.TypeChecker,
  fieldName: string,
  typeName: string,
  isJwt: boolean,
): MapType => {
  const indexInfos = checker.getIndexInfosOfType(t);
  if (indexInfos && indexInfos.length !== 1) {
    throwIndexTypeError(t, checker);
  }
  const indexInfo = indexInfos[0];

  // Convert key type
  const [, , keyType] = tsTypeToDataType(
    indexInfo.keyType,
    checker,
    `${fieldName}_key`,
    typeName,
    isJwt,
  );

  // Convert value type
  const [, , valueType] = tsTypeToDataType(
    indexInfo.type,
    checker,
    `${fieldName}_value`,
    typeName,
    isJwt,
  );

  return {
    keyType,
    valueType,
  };
};

/**
 * see {@link ClickHouseNamedTuple}
 */
const isNamedTuple = (t: ts.Type, checker: ts.TypeChecker) => {
  const mappingSymbol = t.getProperty("_clickhouse_mapped_type");
  if (mappingSymbol === undefined) {
    return false;
  }
  return isStringLiteral(
    checker.getNonNullableType(checker.getTypeOfSymbol(mappingSymbol)),
    checker,
    "namedTuple",
  );
};

// Validate that the underlying TS type matches the mapped geometry shape
const getGeometryMappedType = (
  t: ts.Type,
  checker: ts.TypeChecker,
): string | null => {
  const mappingSymbol = getPropertyDeep(t, "_clickhouse_mapped_type");
  if (mappingSymbol === undefined) return null;
  const mapped = checker.getNonNullableType(
    checker.getTypeOfSymbol(mappingSymbol),
  );

  // Helper: exact tuple [number, number]
  const isPointTuple = (candidate: ts.Type): boolean => {
    if (candidate.isIntersection()) {
      return candidate.types.some(isPointTuple);
    }
    if (!checker.isTupleType(candidate)) return false;
    const tuple = candidate as TupleType;
    const args = tuple.typeArguments || [];
    if (args.length !== 2) return false;
    return isNumberType(args[0], checker) && isNumberType(args[1], checker);
  };

  // Helper: Array<T> predicate
  const isArrayOf = (
    arrType: ts.Type,
    elementPredicate: (elType: ts.Type) => boolean,
  ): boolean => {
    if (arrType.isIntersection()) {
      return arrType.types.some((t) => isArrayOf(t, elementPredicate));
    }
    if (!checker.isArrayType(arrType)) return false;
    const elementType = arrType.getNumberIndexType();
    if (!elementType) return false;
    return elementPredicate(elementType);
  };

  const expectAndValidate = (shapeName: string, validator: () => boolean) => {
    if (!validator()) {
      throw new UnsupportedFeature(
        `Type annotated as ${shapeName} must be assignable to the expected geometry shape`,
      );
    }
    return shapeName;
  };

  if (mapped.isStringLiteral()) {
    const v = mapped.value;
    switch (v) {
      case "Point":
        return expectAndValidate("Point", () => isPointTuple(t));
      case "Ring":
      case "LineString":
        return expectAndValidate(v, () =>
          isArrayOf(t, (el) => isPointTuple(el)),
        );
      case "MultiLineString":
      case "Polygon":
        return expectAndValidate(v, () =>
          isArrayOf(t, (el) => isArrayOf(el, (inner) => isPointTuple(inner))),
        );
      case "MultiPolygon":
        return expectAndValidate(v, () =>
          isArrayOf(t, (el) =>
            isArrayOf(el, (inner) => isArrayOf(inner, isPointTuple)),
          ),
        );
    }
  }
  return null;
};

const checkColumnHasNoDefault = (c: Column) => {
  if (c.default !== null) {
    throw new UnsupportedFeature(
      "Default in inner field. Put ClickHouseDefault in top level field.",
    );
  }
};

const handleNested = (
  t: ts.Type,
  checker: ts.TypeChecker,
  fieldName: string,
  jwt: boolean,
): Nested => {
  const columns = toColumns(t, checker);
  columns.forEach(checkColumnHasNoDefault);
  return {
    name: getNestedName(t, fieldName),
    columns,
    jwt,
  };
};

const handleNamedTuple = (
  t: ts.Type,
  checker: ts.TypeChecker,
): NamedTupleType => {
  return {
    fields: toColumns(t, checker).flatMap((c) => {
      if (c.name === "_clickhouse_mapped_type") return [];

      checkColumnHasNoDefault(c);
      const t = c.required ? c.data_type : { nullable: c.data_type };
      return [[c.name, t]];
    }),
  };
};

const tsTypeToDataType = (
  t: ts.Type,
  checker: TypeChecker,
  fieldName: string,
  typeName: string,
  isJwt: boolean,
  typeNode?: ts.TypeNode,
): [boolean, [string, any][], DataType] => {
  const nonNull = t.getNonNullableType();
  const nullable = nonNull != t;

  const aggregationFunction = handleAggregated(t, checker, fieldName, typeName);
  const simpleAggregationFunction = handleSimpleAggregated(
    t,
    checker,
    fieldName,
    typeName,
  );

  let withoutTags = nonNull;
  // clean up intersection type tags
  if (nonNull.isIntersection()) {
    const nonTagTypes = nonNull.types.filter(
      (candidate) => !isSingleUnderscoreMetaObject(candidate, checker),
    );

    if (nonTagTypes.length == 1) {
      withoutTags = nonTagTypes[0];
    }
  }

  // Recognize Date aliases (DateTime, DateTime64<P>) as DateTime-like
  let datePrecisionFromNode: number | undefined = undefined;
  if (typeNode && isTypeReferenceNode(typeNode)) {
    const tn = typeNode.typeName;
    const name = isIdentifier(tn) ? tn.text : tn.right.text;
    if (name === "DateTime64") {
      const arg = typeNode.typeArguments?.[0];
      if (
        arg &&
        ts.isLiteralTypeNode(arg) &&
        ts.isNumericLiteral(arg.literal)
      ) {
        datePrecisionFromNode = Number(arg.literal.text);
      }
    } else if (name === "DateTime") {
      datePrecisionFromNode = undefined; // DateTime without explicit precision
    }
  }

  const annotations: [string, any][] = [];

  const typeSymbolName = nonNull.symbol?.name || t.symbol?.name;
  const isDateLike =
    typeSymbolName === "DateTime" ||
    typeSymbolName === "DateTime64" ||
    checker.isTypeAssignableTo(nonNull, dateType(checker));

  let dataType: DataType;
  if (isEnum(nonNull)) {
    dataType = enumConvert(nonNull);
  } else {
    const jsonCandidate = getJsonMappedType(nonNull, checker);
    if (jsonCandidate !== null) {
      dataType = jsonCandidate;
    } else if (isStringAnyRecord(nonNull, checker)) {
      dataType = "Json";
    } else if (isDateLike) {
      // Prefer precision from AST (DateTime64<P>) if available
      if (datePrecisionFromNode !== undefined) {
        dataType = `DateTime(${datePrecisionFromNode})` as DataType;
      } else {
        // Add precision support for Date via ClickHousePrecision<P>
        const precisionSymbol =
          getPropertyDeep(nonNull, "_clickhouse_precision") ||
          getPropertyDeep(t, "_clickhouse_precision");
        if (precisionSymbol !== undefined) {
          const precisionType = checker.getNonNullableType(
            checker.getTypeOfSymbol(precisionSymbol),
          );
          if (precisionType.isNumberLiteral()) {
            dataType = `DateTime(${precisionType.value})` as DataType;
          } else {
            dataType = "DateTime";
          }
        } else {
          dataType = "DateTime";
        }
      }
    } else if (checker.isTypeAssignableTo(nonNull, checker.getStringType())) {
      dataType = handleStringType(nonNull, checker, fieldName, annotations);
    } else if (isNumberType(nonNull, checker)) {
      dataType = handleNumberType(nonNull, checker, fieldName);
    } else if (checker.isTypeAssignableTo(nonNull, checker.getBooleanType())) {
      dataType = "Boolean";
    } else if (getGeometryMappedType(nonNull, checker) !== null) {
      dataType = getGeometryMappedType(nonNull, checker)!;
    } else if (checker.isArrayType(withoutTags)) {
      dataType = toArrayType(
        tsTypeToDataType(
          nonNull.getNumberIndexType()!,
          checker,
          fieldName,
          typeName,
          isJwt,
          undefined,
        ),
      );
    } else if (isNamedTuple(nonNull, checker)) {
      dataType = handleNamedTuple(nonNull, checker);
    } else if (isRecordType(nonNull, checker)) {
      dataType = handleRecordType(nonNull, checker, fieldName, typeName, isJwt);
    } else if (
      withoutTags.isClassOrInterface() ||
      (withoutTags.flags & TypeFlags.Object) !== 0
    ) {
      dataType = handleNested(withoutTags, checker, fieldName, isJwt);
    } else if (nonNull == checker.getNeverType()) {
      dataType = throwNullType(fieldName, typeName);
    } else {
      dataType = throwUnknownType(t, fieldName, typeName);
    }
  }
  if (aggregationFunction !== undefined) {
    annotations.push(["aggregationFunction", aggregationFunction]);
  }
  if (simpleAggregationFunction !== undefined) {
    annotations.push(["simpleAggregationFunction", simpleAggregationFunction]);
  }

  const lowCardinalitySymbol = t.getProperty("_LowCardinality");
  if (lowCardinalitySymbol !== undefined) {
    const lowCardinalityType = checker.getNonNullableType(
      checker.getTypeOfSymbol(lowCardinalitySymbol),
    );

    if (lowCardinalityType == checker.getTrueType()) {
      annotations.push(["LowCardinality", true]);
    }
  }

  return [nullable, annotations, dataType];
};

const getNestedName = (t: ts.Type, fieldName: string) => {
  const name = t.symbol.name;
  // replace default name
  return name === "__type" ? fieldName : name;
};

const hasWrapping = (
  typeNode: ts.TypeNode | undefined,
  wrapperName: string,
) => {
  if (typeNode !== undefined && isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName;
    const name = isIdentifier(typeName) ? typeName.text : typeName.right.text;
    return name === wrapperName && typeNode.typeArguments?.length === 1;
  } else {
    return false;
  }
};

const hasKeyWrapping = (typeNode: ts.TypeNode | undefined) => {
  return hasWrapping(typeNode, "Key");
};

const hasJwtWrapping = (typeNode: ts.TypeNode | undefined) => {
  return hasWrapping(typeNode, "JWT");
};

const handleDefaultWrapping = (
  typeNode: ts.TypeNode | undefined,
): string | undefined => {
  if (typeNode !== undefined && isTypeReferenceNode(typeNode)) {
    const typeName = typeNode.typeName;
    const name = isIdentifier(typeName) ? typeName.text : typeName.right.text;
    if (name === "WithDefault" && typeNode.typeArguments?.length === 2) {
      const defaultValueType = typeNode.typeArguments[1];
      if (
        ts.isLiteralTypeNode(defaultValueType) &&
        ts.isStringLiteral(defaultValueType.literal)
      ) {
        return defaultValueType.literal.text;
      }
    }
  }
  return undefined;
};

/** Detect ClickHouse Codec annotation on a type and return codec expression */
const handleCodec = (t: ts.Type, checker: TypeChecker): string | null => {
  const codecType = getTaggedType(t, checker, "_clickhouse_codec");
  if (codecType === null) {
    return null;
  }
  if (!codecType.isStringLiteral()) {
    throw new UnsupportedFeature(
      'ClickHouseCodec must use a string literal, e.g. ClickHouseCodec<"ZSTD(3)">',
    );
  }
  return codecType.value;
};

export interface ToColumnsOptions {
  /**
   * When true, allows types with index signatures (e.g., [key: string]: any).
   * Only named properties will be extracted as columns.
   * This is useful for IngestApi where arbitrary fields should be accepted
   * and passed through to streaming functions.
   */
  allowIndexSignatures?: boolean;
}

export const toColumns = (
  t: ts.Type,
  checker: TypeChecker,
  options?: ToColumnsOptions,
): Column[] => {
  // Only check for index signatures if not explicitly allowed
  if (
    !options?.allowIndexSignatures &&
    checker.getIndexInfosOfType(t).length !== 0
  ) {
    console.log("[CompilerPlugin]", checker.getIndexInfosOfType(t));
    throwIndexTypeError(t, checker);
  }

  return checker.getPropertiesOfType(t).map((prop) => {
    let declarations = prop.getDeclarations();
    const node =
      declarations && declarations.length > 0 ?
        (declarations[0] as ts.PropertyDeclaration)
      : undefined;
    const type =
      node !== undefined ?
        checker.getTypeOfSymbolAtLocation(prop, node)
      : checker.getTypeOfSymbol(prop);

    const isKey = hasKeyWrapping(node?.type);
    const isJwt = hasJwtWrapping(node?.type);

    const defaultExpression = handleDefaultWrapping(node?.type);

    const [nullable, annotations, dataType] = tsTypeToDataType(
      type,
      checker,
      prop.name,
      t.symbol?.name || "inline_type",
      isJwt,
      node?.type,
    );

    return {
      name: prop.name,
      data_type: dataType,
      primary_key: isKey,
      required: !nullable,
      unique: false,
      default: defaultExpression ?? handleDefault(type, checker),
      ttl: handleTtl(type, checker),
      codec: handleCodec(type, checker),
      annotations,
    };
  });
};
