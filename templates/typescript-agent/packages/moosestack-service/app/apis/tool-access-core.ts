type RuntimeDataType =
  | string
  | { nullable: RuntimeDataType }
  | { values: RuntimeEnumValue[] }
  | { elementType: RuntimeDataType; elementNullable: boolean }
  | { columns: RuntimeColumn[]; jwt: boolean; name: string }
  | { fields: Array<[string, RuntimeDataType]> }
  | { keyType: RuntimeDataType; valueType: RuntimeDataType }
  | Record<string, unknown>;

type RuntimeEnumValue =
  | { name: string; value: { Int: number } }
  | { name: string; value: { String: string } };

interface RuntimeColumn {
  name: string;
  data_type: RuntimeDataType;
  required: boolean;
  annotations: Array<[string, unknown]>;
  comment: string | null;
}

export interface RuntimeTable {
  config: { engine: string };
  columnArray: RuntimeColumn[];
  generateTableName(): string;
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  comment?: string;
}

interface TableInfo {
  name: string;
  engine: string;
  columns: ColumnInfo[];
}

export interface DataCatalogResponse {
  tables?: Record<string, TableInfo>;
  materialized_views?: Record<string, TableInfo>;
}

function isNullableType(
  dataType: RuntimeDataType,
): dataType is { nullable: RuntimeDataType } {
  return (
    typeof dataType === "object" &&
    dataType !== null &&
    "nullable" in dataType &&
    !("values" in dataType)
  );
}

function isEnumType(
  dataType: RuntimeDataType,
): dataType is { values: RuntimeEnumValue[] } {
  return (
    typeof dataType === "object" &&
    dataType !== null &&
    "values" in dataType &&
    Array.isArray((dataType as { values?: unknown }).values)
  );
}

function isArrayType(
  dataType: RuntimeDataType,
): dataType is { elementType: RuntimeDataType; elementNullable: boolean } {
  return (
    typeof dataType === "object" &&
    dataType !== null &&
    "elementType" in dataType
  );
}

function isNestedType(
  dataType: RuntimeDataType,
): dataType is { columns: RuntimeColumn[]; jwt: boolean; name: string } {
  return (
    typeof dataType === "object" &&
    dataType !== null &&
    "columns" in dataType &&
    Array.isArray((dataType as { columns?: unknown }).columns)
  );
}

function isNamedTupleType(
  dataType: RuntimeDataType,
): dataType is { fields: Array<[string, RuntimeDataType]> } {
  return (
    typeof dataType === "object" &&
    dataType !== null &&
    "fields" in dataType &&
    Array.isArray((dataType as { fields?: unknown }).fields)
  );
}

function isMapType(
  dataType: RuntimeDataType,
): dataType is { keyType: RuntimeDataType; valueType: RuntimeDataType } {
  return (
    typeof dataType === "object" &&
    dataType !== null &&
    "keyType" in dataType &&
    "valueType" in dataType
  );
}

function hasAnnotation(column: RuntimeColumn, annotationName: string): boolean {
  return column.annotations.some(([name, value]) => {
    return name === annotationName && value === true;
  });
}

function isIntEnumValue(
  value: RuntimeEnumValue,
): value is { name: string; value: { Int: number } } {
  return "Int" in value.value;
}

function renderEnumType(values: RuntimeEnumValue[]): string {
  if (values.length === 0) {
    return "Enum8()";
  }

  if (values.every(isIntEnumValue)) {
    const numbers = values.map((entry) => entry.value.Int);
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);
    const enumType = min >= -128 && max <= 127 ? "Enum8" : "Enum16";
    const members = values
      .map((entry) => `'${entry.name}' = ${entry.value.Int}`)
      .join(", ");
    return `${enumType}(${members})`;
  }

  const members = values
    .map((entry) => {
      if (isIntEnumValue(entry)) {
        return `'${entry.name}' = ${entry.value.Int}`;
      }

      return `'${entry.name}' = '${entry.value.String}'`;
    })
    .join(", ");
  return `Enum(${members})`;
}

function renderRuntimeDataType(dataType: RuntimeDataType): string {
  if (typeof dataType === "string") {
    return dataType;
  }

  if (isNullableType(dataType)) {
    return `Nullable(${renderRuntimeDataType(dataType.nullable)})`;
  }

  if (isEnumType(dataType)) {
    return renderEnumType(dataType.values);
  }

  if (isArrayType(dataType)) {
    const elementType =
      dataType.elementNullable ?
        `Nullable(${renderRuntimeDataType(dataType.elementType)})`
      : renderRuntimeDataType(dataType.elementType);
    return `Array(${elementType})`;
  }

  if (isNestedType(dataType)) {
    const fields = dataType.columns
      .map((column) => `${column.name} ${renderColumnType(column)}`)
      .join(", ");
    return `Nested(${fields})`;
  }

  if (isNamedTupleType(dataType)) {
    const fields = dataType.fields
      .map(([name, fieldType]) => `${name} ${renderRuntimeDataType(fieldType)}`)
      .join(", ");
    return `Tuple(${fields})`;
  }

  if (isMapType(dataType)) {
    return `Map(${renderRuntimeDataType(dataType.keyType)}, ${renderRuntimeDataType(dataType.valueType)})`;
  }

  return "JSON";
}

function renderColumnType(column: RuntimeColumn): string {
  let renderedType = renderRuntimeDataType(
    column.required ? column.data_type : { nullable: column.data_type },
  );

  if (hasAnnotation(column, "LowCardinality")) {
    renderedType = `LowCardinality(${renderedType})`;
  }

  return renderedType;
}

function toColumnInfo(column: RuntimeColumn): ColumnInfo {
  return {
    name: column.name,
    type: renderColumnType(column),
    nullable: !column.required,
    ...(column.comment ? { comment: column.comment } : {}),
  };
}

function toTableInfo(table: RuntimeTable): TableInfo {
  return {
    name: table.generateTableName(),
    engine: table.config.engine,
    columns: table.columnArray.map(toColumnInfo),
  };
}

function matchesSearchPattern(name: string, searchPattern?: string): boolean {
  if (!searchPattern) {
    return true;
  }

  try {
    return new RegExp(searchPattern, "i").test(name);
  } catch {
    return name.toLowerCase().includes(searchPattern.toLowerCase());
  }
}

function stripSqlComments(query: string): string {
  return query.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ");
}

function normalizeIdentifier(identifier: string): string {
  const normalizedSegment = identifier
    .trim()
    .replace(/;+$/, "")
    .split(".")
    .pop();

  if (!normalizedSegment) {
    throw new Error("Query references an empty table identifier.");
  }

  return normalizedSegment
    .replace(/^["`]/, "")
    .replace(/["`]$/, "")
    .toLowerCase();
}

export function createToolAccessPolicy(exposedTables: readonly RuntimeTable[]) {
  const exposedComponentNames = new Set(
    exposedTables.map((table) => table.generateTableName().toLowerCase()),
  );
  const availableComponentList = Array.from(exposedComponentNames)
    .sort()
    .join(", ");

  function assertExposedIdentifier(identifier: string) {
    if (!exposedComponentNames.has(identifier)) {
      throw new Error(
        `Table '${identifier}' is not exposed by default. Available tables: ${availableComponentList}. Update app/apis/tool-access.ts if you want to allow it.`,
      );
    }
  }

  function validateDescribeQuery(query: string) {
    const match = query.match(
      /^\s*(?:describe|desc)(?:\s+table)?\s+([`"\w.]+)/i,
    );

    if (!match) {
      throw new Error(
        "DESCRIBE queries must target one explicitly exposed table or materialized view.",
      );
    }

    assertExposedIdentifier(normalizeIdentifier(match[1]));
  }

  function validateSelectLikeQuery(query: string) {
    const identifiers = Array.from(
      query.matchAll(/\b(?:from|join)\s+([`"\w.]+)/gi),
    ).map((match) => normalizeIdentifier(match[1]));

    if (identifiers.length === 0) {
      throw new Error(
        "Queries must read from at least one explicitly exposed table or materialized view.",
      );
    }

    for (const identifier of identifiers) {
      assertExposedIdentifier(identifier);
    }
  }

  return {
    getExposedDataCatalog(
      componentType?: "tables" | "materialized_views",
      searchPattern?: string,
    ): {
      tables: TableInfo[];
      materializedViews: TableInfo[];
    } {
      const tables =
        componentType === "materialized_views" ?
          []
        : exposedTables
            .map(toTableInfo)
            .filter((table) => matchesSearchPattern(table.name, searchPattern));

      return {
        tables,
        materializedViews: [],
      };
    },

    formatExposedCatalogSummary(
      tables: TableInfo[],
      materializedViews: TableInfo[],
    ): string {
      if (tables.length === 0 && materializedViews.length === 0) {
        return "No data components found matching the specified filters.";
      }

      let output = "# Data Catalog (Summary)\n\n";

      if (tables.length > 0) {
        output += `## Tables (${tables.length})\n`;
        for (const table of tables) {
          output += `- ${table.name} (${table.columns.length} columns)\n`;
        }
        output += "\n";
      }

      if (materializedViews.length > 0) {
        output += `## Materialized Views (${materializedViews.length})\n`;
        for (const view of materializedViews) {
          output += `- ${view.name} (${view.columns.length} columns)\n`;
        }
        output += "\n";
      }

      return output;
    },

    formatExposedCatalogDetailed(
      tables: TableInfo[],
      materializedViews: TableInfo[],
    ): string {
      const catalog: DataCatalogResponse = {};

      if (tables.length > 0) {
        catalog.tables = Object.fromEntries(
          tables.map((table) => [table.name, table]),
        );
      }

      if (materializedViews.length > 0) {
        catalog.materialized_views = Object.fromEntries(
          materializedViews.map((view) => [view.name, view]),
        );
      }

      return JSON.stringify(catalog, null, 2);
    },

    validateExposedReadonlyQuery(rawQuery: string): string {
      const query = stripSqlComments(rawQuery).trim().replace(/;+$/, "");

      if (!query) {
        throw new Error("Query is required.");
      }

      if (/\bsystem\s*\./i.test(query)) {
        throw new Error(
          "System metadata is not exposed by default. Use get_data_catalog for the allowlisted schema surface.",
        );
      }

      if (
        /\b(show|exists|insert|update|delete|alter|create|drop|optimize|grant|revoke|attach|detach|rename|truncate|use|kill)\b/i.test(
          query,
        )
      ) {
        throw new Error(
          "Only SELECT, DESCRIBE, and EXPLAIN SELECT queries against exposed data components are allowed by default.",
        );
      }

      if (/^\s*(describe|desc)\b/i.test(query)) {
        validateDescribeQuery(query);
        return query;
      }

      if (/^\s*explain\b/i.test(query)) {
        const selectIndex = query.search(/\bselect\b/i);
        if (selectIndex < 0) {
          throw new Error(
            "Only EXPLAIN SELECT queries are allowed by default, and they must target exposed data components.",
          );
        }

        validateSelectLikeQuery(query.slice(selectIndex));
        return query;
      }

      if (/^\s*select\b/i.test(query)) {
        validateSelectLikeQuery(query);
        return query;
      }

      throw new Error(
        "Only SELECT, DESCRIBE, and EXPLAIN SELECT queries against exposed data components are allowed by default.",
      );
    },
  };
}
