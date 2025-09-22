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
      (t) => tsTypeToDataType(t, checker, fieldName, typeName, false)[2],
    );
    return { functionName: functionStringLiteral.value, argumentTypes };
  } else {
    console.log("Unexpected type inside Aggregated", functionStringLiteral);
    return undefined;
  }
};

/** Detect ClickHouse default annotation on a type and return raw sql */
const handleDefault = (t: ts.Type, checker: TypeChecker): string | null => {
  // Ensure we check the non-nullable part so optionals still surface defaults
  const nonNull = t.getNonNullableType();
  const defaultSymbol = nonNull.getProperty("_clickhouse_default");
  if (defaultSymbol === undefined) return null;
  const defaultType = checker.getNonNullableType(
    checker.getTypeOfSymbol(defaultSymbol),
  );
  if (!defaultType.isStringLiteral()) {
    throw new UnsupportedFeature(
      'ClickHouseDefault must use a string literal, e.g. ClickHouseDefault<"now()">',
    );
  }
  return defaultType.value;
};

const handleNumberType = (
  t: ts.Type,
  checker: TypeChecker,
  fieldName: string,
): string => {
  const tagSymbol = t.getProperty("typia.tag");
  if (tagSymbol === undefined) {
    return "Float";
  } else {
    const typiaProps = checker.getNonNullableType(
      checker.getTypeOfSymbol(tagSymbol),
    );
    const props: ts.Type[] =
      typiaProps.isIntersection() ? typiaProps.types : [typiaProps];

    for (const prop of props) {
      const valueSymbol = prop.getProperty("value");
      if (valueSymbol === undefined) {
        console.log(`Props.value is undefined for ${fieldName}`);
      } else {
        const valueTypeLiteral = checker.getTypeOfSymbol(valueSymbol);
        const numberTypeMappings = {
          float: "Float32",
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
            `Other number types are not supported: ${typeString} in field ${fieldName}`,
          );
        }
      }
    }

    return "Float";
  }
};

export interface AggregationFunction {
  functionName: string;
  argumentTypes: DataType[];
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
        console.log(`Props.value is undefined for ${fieldName}`);
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

          console.log(`Unknown format: ${typeString} in field ${fieldName}`);
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

const handleNamedTuple = (
  t: ts.Type,
  checker: ts.TypeChecker,
): NamedTupleType => {
  return {
    fields: toColumns(t, checker).flatMap((c) => {
      if (c.name === "_clickhouse_mapped_type") return [];
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
): [boolean, [string, any][], DataType] => {
  const nonNull = t.getNonNullableType();
  const nullable = nonNull != t;

  const aggregationFunction = handleAggregated(t, checker, fieldName, typeName);
  const annotations: [string, any][] = [];

  const dataType: DataType =
    isEnum(nonNull) ? enumConvert(nonNull)
    : isStringAnyRecord(nonNull, checker) ? "Json"
    : checker.isTypeAssignableTo(nonNull, checker.getStringType()) ?
      handleStringType(nonNull, checker, fieldName, annotations)
    : isNumberType(nonNull, checker) ?
      handleNumberType(nonNull, checker, fieldName)
    : checker.isTypeAssignableTo(nonNull, checker.getBooleanType()) ? "Boolean"
    : checker.isTypeAssignableTo(nonNull, dateType(checker)) ? "DateTime"
    : checker.isArrayType(nonNull) ?
      toArrayType(
        tsTypeToDataType(
          nonNull.getNumberIndexType()!,
          checker,
          fieldName,
          typeName,
          isJwt,
        ),
      )
    : isNamedTuple(nonNull, checker) ? handleNamedTuple(nonNull, checker)
    : isRecordType(nonNull, checker) ?
      handleRecordType(nonNull, checker, fieldName, typeName, isJwt)
    : nonNull.isClassOrInterface() || (nonNull.flags & TypeFlags.Object) !== 0 ?
      {
        name: getNestedName(nonNull, fieldName),
        columns: toColumns(nonNull, checker),
        jwt: isJwt,
      }
    : nonNull == checker.getNeverType() ? throwNullType(fieldName, typeName)
    : throwUnknownType(t, fieldName, typeName);
  if (aggregationFunction !== undefined) {
    annotations.push(["aggregationFunction", aggregationFunction]);
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

export const toColumns = (t: ts.Type, checker: TypeChecker): Column[] => {
  if (checker.getIndexInfosOfType(t).length !== 0) {
    console.log(checker.getIndexInfosOfType(t));
    throwIndexTypeError(t, checker);
  }

  return checker.getPropertiesOfType(t).map((prop) => {
    const node = prop.getDeclarations()![0] as ts.PropertyDeclaration;
    const type = checker.getTypeOfSymbolAtLocation(prop, node);

    const isKey = hasKeyWrapping(node.type);
    const isJwt = hasJwtWrapping(node.type);

    const defaultExpression = handleDefaultWrapping(node.type);

    const [nullable, annotations, dataType] = tsTypeToDataType(
      type,
      checker,
      prop.name,
      t.symbol?.name || "inline_type",
      isJwt,
    );

    return {
      name: prop.name,
      data_type: dataType,
      primary_key: isKey,
      required: !nullable,
      unique: false,
      default: defaultExpression ?? handleDefault(type, checker),
      annotations,
    };
  });
};
