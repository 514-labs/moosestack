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
  config: unknown;
  columnArray: RuntimeColumn[];
  generateTableName(): string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  comment?: string;
}

export interface TableInfo {
  name: string;
  engine: string;
  columns: ColumnInfo[];
}

export interface DataCatalogResponse {
  tables?: Record<string, TableInfo>;
  materialized_views?: Record<string, TableInfo>;
}

export interface ToolAccessCatalog {
  tables: TableInfo[];
  materializedViews: TableInfo[];
}

export interface ToolAccessPolicy {
  getExposedDataCatalog(
    componentType?: "tables" | "materialized_views",
    searchPattern?: string,
  ): ToolAccessCatalog;
  formatExposedCatalogSummary(
    tables: TableInfo[],
    materializedViews: TableInfo[],
  ): string;
  formatExposedCatalogDetailed(
    tables: TableInfo[],
    materializedViews: TableInfo[],
  ): string;
  validateExposedReadonlyQuery(rawQuery: string): string;
}

const MAX_SEARCH_PATTERN_LENGTH = 128;
const MAX_SEARCH_PATTERN_METACHARACTERS = 12;
const READONLY_QUERY_KEYWORD_PATTERN =
  /\b(show|insert|update|delete|alter|create|drop|optimize|grant|revoke|attach|detach|rename|truncate|use|kill)\b/i;
const TABLE_REFERENCE_BOUNDARY_KEYWORDS = new Set([
  "array",
  "except",
  "final",
  "format",
  "full",
  "group",
  "having",
  "inner",
  "intersect",
  "join",
  "left",
  "limit",
  "on",
  "order",
  "outer",
  "prewhere",
  "right",
  "sample",
  "settings",
  "union",
  "using",
  "where",
]);

function getTableEngine(table: RuntimeTable): string {
  if (typeof table.config !== "object" || table.config === null) {
    return "MergeTree";
  }

  const engine = Reflect.get(table.config, "engine");
  return typeof engine === "string" ? engine : "MergeTree";
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
    engine: getTableEngine(table),
    columns: table.columnArray.map(toColumnInfo),
  };
}

function shouldFallbackToSubstringSearch(searchPattern: string): boolean {
  if (searchPattern.length > MAX_SEARCH_PATTERN_LENGTH) {
    return true;
  }

  if (/\\[1-9]|(^|[^\\])\(\?/.test(searchPattern)) {
    return true;
  }

  const regexMetacharacterCount = (searchPattern.match(/[\\()[\]{}+*?]/g) ?? [])
    .length;
  return regexMetacharacterCount > MAX_SEARCH_PATTERN_METACHARACTERS;
}

function matchesSearchPattern(name: string, searchPattern?: string): boolean {
  if (!searchPattern) {
    return true;
  }

  if (shouldFallbackToSubstringSearch(searchPattern)) {
    return name.toLowerCase().includes(searchPattern.toLowerCase());
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

// Mask string contents so validation scans do not treat quoted text as SQL.
function maskSqlStringLiterals(query: string): string {
  let result = "";

  for (let index = 0; index < query.length; index += 1) {
    const char = query[index];

    if (char !== "'") {
      result += char;
      continue;
    }

    result += " ";

    for (index += 1; index < query.length; index += 1) {
      const current = query[index];

      if (current === "\\") {
        result += " ";

        if (index + 1 < query.length) {
          result += " ";
          index += 1;
        }

        continue;
      }

      if (current === "'") {
        if (query[index + 1] === "'") {
          result += "  ";
          index += 1;
          continue;
        }

        result += " ";
        break;
      }

      result += " ";
    }
  }

  return result;
}

function normalizeIdentifier(identifier: string): string {
  const normalizedIdentifier = identifier.trim().replace(/;+$/, "");
  const unquotedIdentifier = normalizedIdentifier
    .replace(/^["`]/, "")
    .replace(/["`]$/, "");

  if (unquotedIdentifier.includes(".")) {
    throw new Error(
      "Qualified table names are not allowed. Query exposed components without a database prefix.",
    );
  }

  if (!unquotedIdentifier) {
    throw new Error("Query references an empty table identifier.");
  }

  return unquotedIdentifier.toLowerCase();
}

type SqlToken =
  | { kind: "comma" | "dot" | "paren"; value: string }
  | { kind: "quoted_identifier" | "word"; value: string };

function tokenizeSql(query: string): SqlToken[] {
  const tokens: SqlToken[] = [];

  for (let index = 0; index < query.length; ) {
    const char = query[index];

    if (!char) {
      break;
    }

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "," || char === "." || char === "(" || char === ")") {
      tokens.push({
        kind:
          char === "," ? "comma"
          : char === "." ? "dot"
          : "paren",
        value: char,
      });
      index += 1;
      continue;
    }

    if (char === '"' || char === "`") {
      const quote = char;
      let value = quote;
      index += 1;

      while (index < query.length) {
        const current = query[index];
        value += current;
        index += 1;

        if (current === quote) {
          break;
        }
      }

      tokens.push({ kind: "quoted_identifier", value });
      continue;
    }

    if (/[A-Za-z_]/.test(char)) {
      let value = char;
      index += 1;

      while (index < query.length && /[A-Za-z0-9_$]/.test(query[index] ?? "")) {
        value += query[index];
        index += 1;
      }

      tokens.push({ kind: "word", value });
      continue;
    }

    index += 1;
  }

  return tokens;
}

function isIdentifierToken(
  token: SqlToken | undefined,
): token is Extract<SqlToken, { kind: "quoted_identifier" | "word" }> {
  return token?.kind === "word" || token?.kind === "quoted_identifier";
}

function readCompositeIdentifier(
  tokens: SqlToken[],
  startIndex: number,
): { identifier: string; nextIndex: number } | undefined {
  const firstToken = tokens[startIndex];
  if (!isIdentifierToken(firstToken)) {
    return undefined;
  }

  let identifier = firstToken.value;
  let nextIndex = startIndex + 1;

  while (tokens[nextIndex]?.kind === "dot") {
    const nextToken = tokens[nextIndex + 1];
    if (!isIdentifierToken(nextToken)) {
      break;
    }

    identifier += `.${nextToken.value}`;
    nextIndex += 2;
  }

  return {
    identifier,
    nextIndex,
  };
}

function skipOptionalAlias(tokens: SqlToken[], startIndex: number): number {
  const token = tokens[startIndex];
  if (!token) {
    return startIndex;
  }

  if (token.kind === "word" && token.value.toLowerCase() === "as") {
    return isIdentifierToken(tokens[startIndex + 1]) ?
        startIndex + 2
      : startIndex + 1;
  }

  if (
    isIdentifierToken(token) &&
    !(
      token.kind === "word" &&
      TABLE_REFERENCE_BOUNDARY_KEYWORDS.has(token.value.toLowerCase())
    )
  ) {
    return startIndex + 1;
  }

  return startIndex;
}

export function createToolAccessPolicy(
  exposedTables: readonly RuntimeTable[],
): ToolAccessPolicy {
  const exposedComponentNames = new Set(
    exposedTables.map((table) => table.generateTableName().toLowerCase()),
  );
  const availableComponentList = Array.from(exposedComponentNames)
    .sort()
    .join(", ");

  function assertExposedIdentifier(identifier: string) {
    if (!exposedComponentNames.has(identifier)) {
      throw new Error(
        `Table '${identifier}' is not exposed by default. Available tables: ${availableComponentList}. Update app/mcp/tool-access/exposed-surface.ts if you want to allow it.`,
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
    const identifiers: string[] = [];
    const tokens = tokenizeSql(query);

    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token?.kind !== "word") {
        continue;
      }

      const keyword = token.value.toLowerCase();
      if (keyword !== "from" && keyword !== "join") {
        continue;
      }

      if (
        keyword === "join" &&
        tokens[index - 1]?.kind === "word" &&
        tokens[index - 1].value.toLowerCase() === "array"
      ) {
        continue;
      }

      if (
        tokens[index + 1]?.kind === "paren" &&
        tokens[index + 1]?.value === "("
      ) {
        continue;
      }

      const tableReference = readCompositeIdentifier(tokens, index + 1);
      if (!tableReference) {
        continue;
      }

      identifiers.push(normalizeIdentifier(tableReference.identifier));

      if (
        tokens[skipOptionalAlias(tokens, tableReference.nextIndex)]?.kind ===
        "comma"
      ) {
        throw new Error(
          "Comma-separated FROM and JOIN target lists are not allowed. Use explicit JOIN syntax against exposed data components.",
        );
      }
    }

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
      const sanitizedQuery = maskSqlStringLiterals(query);

      if (!query) {
        throw new Error("Query is required.");
      }

      if (/\bsystem\s*\./i.test(sanitizedQuery)) {
        throw new Error(
          "System metadata is not exposed by default. Use get_data_catalog for the allowlisted schema surface.",
        );
      }

      if (READONLY_QUERY_KEYWORD_PATTERN.test(sanitizedQuery)) {
        throw new Error(
          "Only SELECT, DESCRIBE, and EXPLAIN SELECT queries against exposed data components are allowed by default.",
        );
      }

      if (/^\s*(describe|desc)\b/i.test(sanitizedQuery)) {
        validateDescribeQuery(sanitizedQuery);
        return query;
      }

      if (/^\s*explain\b/i.test(sanitizedQuery)) {
        const selectIndex = sanitizedQuery.search(/\bselect\b/i);
        if (selectIndex < 0) {
          throw new Error(
            "Only EXPLAIN SELECT queries are allowed by default, and they must target exposed data components.",
          );
        }

        validateSelectLikeQuery(sanitizedQuery.slice(selectIndex));
        return query;
      }

      if (/^\s*select\b/i.test(sanitizedQuery)) {
        validateSelectLikeQuery(sanitizedQuery);
        return query;
      }

      throw new Error(
        "Only SELECT, DESCRIBE, and EXPLAIN SELECT queries against exposed data components are allowed by default.",
      );
    },
  };
}
