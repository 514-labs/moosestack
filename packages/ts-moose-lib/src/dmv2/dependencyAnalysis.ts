import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import ts from "typescript";
import { getSourceDir } from "../compiler-config";
import { compilerLog } from "../commons";
import { findSourceFiles, isSourceFilePath } from "./utils/sourceFiles";

type SignatureKind =
  | "Table"
  | "Topic"
  | "ApiEndpoint"
  | "TopicToTableSyncProcess"
  | "View"
  | "MaterializedView"
  | "SqlResource";

export interface InfrastructureSignatureJson {
  id: string;
  kind: SignatureKind;
}

export interface DependencySignatures {
  pullsDataFrom: InfrastructureSignatureJson[];
  pushesDataTo: InfrastructureSignatureJson[];
}

export interface DependencyAnalysisResult {
  apiByKey: Map<string, DependencySignatures>;
  workflowByName: Map<string, DependencySignatures>;
  webAppByName: Map<string, DependencySignatures>;
}

interface RegistryLike {
  tables: Map<string, any>;
  streams: Map<string, any>;
  apis: Map<string, any>;
  workflows: Map<string, any>;
  webApps: Map<string, any>;
}

interface RegistryIndex {
  tableIdsByName: Map<string, string[]>;
  topicIdsByName: Map<string, string[]>;
  tableIds: Set<string>;
  topicIds: Set<string>;
}

type ResourceRef =
  | { kind: "Table"; id: string }
  | { kind: "Topic"; id: string }
  | { kind: "View"; id: string }
  | { kind: "MaterializedView"; id: string; targetTableId?: string }
  | { kind: "SqlResource"; id: string }
  | { kind: "IngestPipeline"; streamId?: string; tableId?: string };

type SqlResolvedResourceRef =
  | { kind: "Table"; id: string }
  | { kind: "Topic"; id: string };

interface AnalysisContext {
  checker: ts.TypeChecker;
  registryIndex: RegistryIndex;
  symbolResourceCache: Map<ts.Symbol, ResourceRef | null>;
  taskExpressionCache: Map<string, ts.NewExpression | null>;
  functionCache: Map<ts.Symbol, ts.FunctionLikeDeclaration[]>;
}

const WRITE_METHODS = new Set(["insert", "send", "publish", "emit", "write"]);
const warnedAmbiguousTableIds = new Set<string>();

function createEmptyResult(): DependencyAnalysisResult {
  return {
    apiByKey: new Map<string, DependencySignatures>(),
    workflowByName: new Map<string, DependencySignatures>(),
    webAppByName: new Map<string, DependencySignatures>(),
  };
}

function buildRegistryIndex(registry: RegistryLike): RegistryIndex {
  const tableIdsByName = new Map<string, string[]>();
  const topicIdsByName = new Map<string, string[]>();
  const tableIds = new Set<string>();
  const topicIds = new Set<string>();

  registry.tables.forEach((table: any, id: string) => {
    tableIds.add(id);
    const baseName = typeof table?.name === "string" ? table.name : id;
    const existing = tableIdsByName.get(baseName) ?? [];
    existing.push(id);
    tableIdsByName.set(baseName, existing);
  });

  registry.streams.forEach((stream: any, id: string) => {
    topicIds.add(id);
    const streamName = typeof stream?.name === "string" ? stream.name : id;
    const existing = topicIdsByName.get(streamName) ?? [];
    existing.push(id);
    topicIdsByName.set(streamName, existing);
  });

  return { tableIdsByName, topicIdsByName, tableIds, topicIds };
}

function resolveTableId(
  tableName: string,
  version: string | undefined,
  index: RegistryIndex,
): string {
  if (version) {
    const candidates = new Set<string>([`${tableName}_${version}`]);
    if (version.includes(".")) {
      candidates.add(`${tableName}_${version.replace(/\./g, "_")}`);
    }

    for (const candidate of candidates) {
      if (index.tableIds.has(candidate)) {
        return candidate;
      }

      const ids = index.tableIdsByName.get(candidate) ?? [];
      if (ids.length === 1) {
        return ids[0];
      }
      if (ids.length > 1) {
        if (ids.includes(candidate)) {
          return candidate;
        }
        return ids[0];
      }
    }

    return `${tableName}_${version}`;
  }

  const ids = index.tableIdsByName.get(tableName) ?? [];
  if (ids.length === 0) {
    return tableName;
  }
  if (ids.includes(tableName)) {
    return tableName;
  }
  if (ids.length > 1) {
    const warningKey = `${tableName}:${ids.join(",")}`;
    if (!warnedAmbiguousTableIds.has(warningKey)) {
      warnedAmbiguousTableIds.add(warningKey);
      compilerLog(
        `Warning: ambiguous table lineage reference '${tableName}' resolved to '${ids[0]}' from candidates [${ids.join(", ")}]. Add an explicit version to disambiguate.`,
      );
    }
  }
  return ids[0];
}

function resolveTopicId(topicName: string, index: RegistryIndex): string {
  const ids = index.topicIdsByName.get(topicName) ?? [];
  if (ids.length === 0) {
    return topicName;
  }
  if (ids.includes(topicName)) {
    return topicName;
  }
  return ids[0];
}

function normalizeSqlIdentifier(token: string): string {
  let normalized = token.trim();
  normalized = normalized.replace(/^[`"'\[]+/, "");
  normalized = normalized.replace(/[`"'\]]+$/, "");
  return normalized;
}

function resolveResourceFromSqlIdentifier(
  identifier: string,
  index: RegistryIndex,
): SqlResolvedResourceRef | undefined {
  const normalized = normalizeSqlIdentifier(identifier);
  if (!normalized) {
    return undefined;
  }

  const candidates = new Set<string>([normalized]);
  if (normalized.includes(".")) {
    const parts = normalized.split(".");
    const suffix = parts[parts.length - 1];
    if (suffix && suffix !== normalized) {
      candidates.add(suffix);
    }
  }

  for (const candidate of [...candidates]) {
    const versionedMatch = candidate.match(/^(.+)_\d+_\d+$/);
    if (versionedMatch?.[1]) {
      candidates.add(versionedMatch[1]);
    }
  }

  for (const candidate of candidates) {
    if (index.tableIds.has(candidate)) {
      return { kind: "Table", id: candidate };
    }
    if (index.tableIdsByName.has(candidate)) {
      return { kind: "Table", id: resolveTableId(candidate, undefined, index) };
    }
    if (index.topicIds.has(candidate)) {
      return { kind: "Topic", id: candidate };
    }
    if (index.topicIdsByName.has(candidate)) {
      return { kind: "Topic", id: resolveTopicId(candidate, index) };
    }
  }

  return undefined;
}

function inferResourcesFromSqlText(
  text: string,
  index: RegistryIndex,
): SqlResolvedResourceRef[] {
  const refs = new Map<string, SqlResolvedResourceRef>();
  const addRef = (ref: SqlResolvedResourceRef | undefined) => {
    if (!ref) {
      return;
    }
    refs.set(`${ref.kind}:${ref.id}`, ref);
  };

  const trimmed = text.trim();
  if (trimmed && !/\s/.test(trimmed)) {
    addRef(resolveResourceFromSqlIdentifier(trimmed, index));
  }

  const relationPattern =
    /\b(?:from|join|into|update|table)\s+([`"'\[]?[A-Za-z_][A-Za-z0-9_.]*[`"'\]]?)/gi;
  for (const match of text.matchAll(relationPattern)) {
    addRef(resolveResourceFromSqlIdentifier(match[1], index));
  }

  return [...refs.values()];
}

function collectSqlTextFragmentsFromExpression(
  expression: ts.Expression,
  ctx: AnalysisContext,
  fragments: string[],
  visitedSymbols = new Set<ts.Symbol>(),
) {
  const unwrapped = unwrapExpression(expression);

  if (
    ts.isStringLiteral(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped)
  ) {
    fragments.push(unwrapped.text);
    return;
  }

  if (ts.isTemplateExpression(unwrapped)) {
    fragments.push(unwrapped.head.text);
    for (const span of unwrapped.templateSpans) {
      fragments.push(span.literal.text);
    }
    return;
  }

  if (ts.isTaggedTemplateExpression(unwrapped)) {
    if (isSqlTag(unwrapped.tag, ctx.checker)) {
      const resources = inferResourcesFromSqlTemplate(unwrapped.template, ctx);
      for (const resource of resources) {
        fragments.push(resource.id);
      }
    }
    return;
  }

  if (ts.isArrayLiteralExpression(unwrapped)) {
    for (const element of unwrapped.elements) {
      if (ts.isExpression(element)) {
        collectSqlTextFragmentsFromExpression(
          element,
          ctx,
          fragments,
          visitedSymbols,
        );
      }
    }
    return;
  }

  if (ts.isCallExpression(unwrapped)) {
    for (const arg of unwrapped.arguments) {
      collectSqlTextFragmentsFromExpression(
        arg,
        ctx,
        fragments,
        visitedSymbols,
      );
    }
    return;
  }

  if (ts.isObjectLiteralExpression(unwrapped)) {
    for (const property of unwrapped.properties) {
      if (ts.isPropertyAssignment(property)) {
        collectSqlTextFragmentsFromExpression(
          property.initializer,
          ctx,
          fragments,
          visitedSymbols,
        );
      }
    }
    return;
  }

  if (ts.isConditionalExpression(unwrapped)) {
    collectSqlTextFragmentsFromExpression(
      unwrapped.whenTrue,
      ctx,
      fragments,
      visitedSymbols,
    );
    collectSqlTextFragmentsFromExpression(
      unwrapped.whenFalse,
      ctx,
      fragments,
      visitedSymbols,
    );
    return;
  }

  if (ts.isBinaryExpression(unwrapped)) {
    collectSqlTextFragmentsFromExpression(
      unwrapped.left,
      ctx,
      fragments,
      visitedSymbols,
    );
    collectSqlTextFragmentsFromExpression(
      unwrapped.right,
      ctx,
      fragments,
      visitedSymbols,
    );
    return;
  }

  if (ts.isIdentifier(unwrapped) || ts.isPropertyAccessExpression(unwrapped)) {
    const staticValue = resolveStaticString(unwrapped, ctx);
    if (staticValue !== undefined) {
      fragments.push(staticValue);
      return;
    }

    const symbol = resolveAliasedSymbol(
      ctx.checker.getSymbolAtLocation(unwrapped),
      ctx.checker,
    );
    if (!symbol || visitedSymbols.has(symbol)) {
      return;
    }
    visitedSymbols.add(symbol);

    for (const declaration of symbol.declarations ?? []) {
      const initializer = resolveSymbolInitializerExpression(declaration);
      if (!initializer) {
        continue;
      }
      collectSqlTextFragmentsFromExpression(
        initializer,
        ctx,
        fragments,
        visitedSymbols,
      );
    }
  }
}

function inferResourcesFromSqlTemplate(
  template: ts.TemplateLiteral,
  ctx: AnalysisContext,
): SqlResolvedResourceRef[] {
  const refs = new Map<string, SqlResolvedResourceRef>();
  const addFromText = (text: string) => {
    for (const ref of inferResourcesFromSqlText(text, ctx.registryIndex)) {
      refs.set(`${ref.kind}:${ref.id}`, ref);
    }
  };

  if (ts.isNoSubstitutionTemplateLiteral(template)) {
    addFromText(template.text);
    return [...refs.values()];
  }

  addFromText(template.head.text);
  for (const span of template.templateSpans) {
    addFromText(span.literal.text);
  }

  return [...refs.values()];
}

function inferResourcesFromSqlCallArguments(
  argumentsList: readonly ts.Expression[],
  ctx: AnalysisContext,
): SqlResolvedResourceRef[] {
  const refs = new Map<string, SqlResolvedResourceRef>();
  const fragments: string[] = [];

  for (const arg of argumentsList) {
    collectSqlTextFragmentsFromExpression(arg, ctx, fragments);
  }

  for (const fragment of fragments) {
    for (const ref of inferResourcesFromSqlText(fragment, ctx.registryIndex)) {
      refs.set(`${ref.kind}:${ref.id}`, ref);
    }
  }

  return [...refs.values()];
}

function getObjectPropertyExpression(
  objectLiteral: ts.ObjectLiteralExpression,
  propertyName: string,
): ts.Expression | undefined {
  for (const property of objectLiteral.properties) {
    if (ts.isPropertyAssignment(property)) {
      const name =
        ts.isIdentifier(property.name) ? property.name.text
        : ts.isStringLiteral(property.name) ? property.name.text
        : undefined;
      if (name === propertyName) {
        return property.initializer;
      }
    }
    if (
      ts.isShorthandPropertyAssignment(property) &&
      property.name.text === propertyName
    ) {
      return property.name;
    }
  }
  return undefined;
}

function resolveAliasedSymbol(
  symbol: ts.Symbol | undefined,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  if (!symbol) {
    return undefined;
  }
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      return checker.getAliasedSymbol(symbol);
    } catch {
      return symbol;
    }
  }
  return symbol;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    if (ts.isParenthesizedExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isAsExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isTypeAssertionExpression(current)) {
      current = current.expression;
      continue;
    }
    if (ts.isNonNullExpression(current)) {
      current = current.expression;
      continue;
    }
  }
  return current;
}

function unwrapCallTargetExpression(expression: ts.Expression): ts.Expression {
  let current = unwrapExpression(expression);
  while (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.CommaToken
  ) {
    current = unwrapExpression(current.right);
  }
  return current;
}

function resolveStaticString(
  expression: ts.Expression | undefined,
  ctx: AnalysisContext,
  visitedSymbols = new Set<ts.Symbol>(),
): string | undefined {
  if (!expression) {
    return undefined;
  }

  const unwrapped = unwrapExpression(expression);
  if (
    ts.isStringLiteral(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped)
  ) {
    return unwrapped.text;
  }

  if (ts.isIdentifier(unwrapped) || ts.isPropertyAccessExpression(unwrapped)) {
    let symbol = resolveAliasedSymbol(
      ctx.checker.getSymbolAtLocation(unwrapped),
      ctx.checker,
    );
    if (!symbol || visitedSymbols.has(symbol)) {
      return undefined;
    }
    visitedSymbols.add(symbol);
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const value = resolveStaticString(
          declaration.initializer,
          ctx,
          visitedSymbols,
        );
        if (value !== undefined) {
          return value;
        }
      } else if (ts.isPropertyAssignment(declaration)) {
        const value = resolveStaticString(
          declaration.initializer,
          ctx,
          visitedSymbols,
        );
        if (value !== undefined) {
          return value;
        }
      }
    }
  }

  return undefined;
}

function resolveObjectLiteralExpression(
  expression: ts.Expression | undefined,
  ctx: AnalysisContext,
  visitedSymbols = new Set<ts.Symbol>(),
): ts.ObjectLiteralExpression | undefined {
  if (!expression) {
    return undefined;
  }

  const unwrapped = unwrapExpression(expression);
  if (ts.isObjectLiteralExpression(unwrapped)) {
    return unwrapped;
  }

  if (ts.isIdentifier(unwrapped) || ts.isPropertyAccessExpression(unwrapped)) {
    let symbol = resolveAliasedSymbol(
      ctx.checker.getSymbolAtLocation(unwrapped),
      ctx.checker,
    );
    if (!symbol || visitedSymbols.has(symbol)) {
      return undefined;
    }
    visitedSymbols.add(symbol);
    for (const declaration of symbol.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const result = resolveObjectLiteralExpression(
          declaration.initializer,
          ctx,
          visitedSymbols,
        );
        if (result) {
          return result;
        }
      } else if (ts.isPropertyAssignment(declaration)) {
        const result = resolveObjectLiteralExpression(
          declaration.initializer,
          ctx,
          visitedSymbols,
        );
        if (result) {
          return result;
        }
      }
    }
  }

  return undefined;
}

function constructorNameFromNewExpression(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): string | undefined {
  const symbol = resolveAliasedSymbol(
    checker.getSymbolAtLocation(expression),
    checker,
  );
  if (symbol?.name) {
    return symbol.name;
  }
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return undefined;
}

function parseOlapTableRef(
  newExpression: ts.NewExpression,
  ctx: AnalysisContext,
): ResourceRef | undefined {
  const tableName = resolveStaticString(newExpression.arguments?.[0], ctx);
  if (!tableName) {
    return undefined;
  }
  const configLiteral = resolveObjectLiteralExpression(
    newExpression.arguments?.[1],
    ctx,
  );
  const version =
    configLiteral ?
      resolveStaticString(
        getObjectPropertyExpression(configLiteral, "version"),
        ctx,
      )
    : undefined;

  return {
    kind: "Table",
    id: resolveTableId(tableName, version, ctx.registryIndex),
  };
}

function parseStreamRef(
  newExpression: ts.NewExpression,
  ctx: AnalysisContext,
): ResourceRef | undefined {
  const topicName = resolveStaticString(newExpression.arguments?.[0], ctx);
  if (!topicName) {
    return undefined;
  }
  return { kind: "Topic", id: resolveTopicId(topicName, ctx.registryIndex) };
}

function parseSimpleNamedRef(
  newExpression: ts.NewExpression,
  kind: "View" | "SqlResource",
  ctx: AnalysisContext,
): ResourceRef | undefined {
  const name = resolveStaticString(newExpression.arguments?.[0], ctx);
  if (!name) {
    return undefined;
  }
  return { kind, id: name };
}

function parseMaterializedViewRef(
  newExpression: ts.NewExpression,
  ctx: AnalysisContext,
): ResourceRef | undefined {
  const options = resolveObjectLiteralExpression(
    newExpression.arguments?.[0],
    ctx,
  );
  if (!options) {
    return undefined;
  }

  const mvName = resolveStaticString(
    getObjectPropertyExpression(options, "materializedViewName"),
    ctx,
  );
  if (!mvName) {
    return undefined;
  }

  let targetTableId: string | undefined;
  const targetTableExpression = getObjectPropertyExpression(
    options,
    "targetTable",
  );
  const targetTableObject = resolveObjectLiteralExpression(
    targetTableExpression,
    ctx,
  );
  if (targetTableObject) {
    const tableName = resolveStaticString(
      getObjectPropertyExpression(targetTableObject, "name"),
      ctx,
    );
    const version = resolveStaticString(
      getObjectPropertyExpression(targetTableObject, "version"),
      ctx,
    );
    if (tableName) {
      targetTableId = resolveTableId(tableName, version, ctx.registryIndex);
    }
  } else if (targetTableExpression) {
    const targetRef = resolveResourceFromExpression(
      targetTableExpression,
      ctx,
      new Map(),
    );
    if (targetRef?.kind === "Table") {
      targetTableId = targetRef.id;
    }
  }

  if (!targetTableId) {
    const legacyTableName = resolveStaticString(
      getObjectPropertyExpression(options, "tableName"),
      ctx,
    );
    if (legacyTableName) {
      targetTableId = resolveTableId(
        legacyTableName,
        undefined,
        ctx.registryIndex,
      );
    }
  }

  return {
    kind: "MaterializedView",
    id: mvName,
    targetTableId,
  };
}

function parseIngestPipelineRef(
  newExpression: ts.NewExpression,
  ctx: AnalysisContext,
): ResourceRef | undefined {
  const pipelineName = resolveStaticString(newExpression.arguments?.[0], ctx);
  if (!pipelineName) {
    return undefined;
  }

  const config = resolveObjectLiteralExpression(
    newExpression.arguments?.[1],
    ctx,
  );
  let version: string | undefined;
  let streamEnabled = true;
  let tableEnabled = true;
  if (config) {
    const versionExpr = getObjectPropertyExpression(config, "version");
    version = resolveStaticString(versionExpr, ctx);

    const streamExpr = getObjectPropertyExpression(config, "stream");
    if (streamExpr && streamExpr.kind === ts.SyntaxKind.FalseKeyword) {
      streamEnabled = false;
    }

    const tableExpr = getObjectPropertyExpression(config, "table");
    if (tableExpr && tableExpr.kind === ts.SyntaxKind.FalseKeyword) {
      tableEnabled = false;
    }
  }

  return {
    kind: "IngestPipeline",
    streamId:
      streamEnabled ?
        resolveTopicId(pipelineName, ctx.registryIndex)
      : undefined,
    tableId:
      tableEnabled ?
        resolveTableId(pipelineName, version, ctx.registryIndex)
      : undefined,
  };
}

function resolveResourceFromNewExpression(
  newExpression: ts.NewExpression,
  ctx: AnalysisContext,
): ResourceRef | undefined {
  const constructorName = constructorNameFromNewExpression(
    newExpression.expression,
    ctx.checker,
  );

  switch (constructorName) {
    case "OlapTable":
      return parseOlapTableRef(newExpression, ctx);
    case "Stream":
      return parseStreamRef(newExpression, ctx);
    case "View":
      return parseSimpleNamedRef(newExpression, "View", ctx);
    case "SqlResource":
      return parseSimpleNamedRef(newExpression, "SqlResource", ctx);
    case "MaterializedView":
      return parseMaterializedViewRef(newExpression, ctx);
    case "IngestPipeline":
      return parseIngestPipelineRef(newExpression, ctx);
    default:
      return undefined;
  }
}

function resolveResourceFromSymbol(
  symbol: ts.Symbol | undefined,
  ctx: AnalysisContext,
  bindings: Map<ts.Symbol, ResourceRef>,
): ResourceRef | undefined {
  const resolvedSymbol = resolveAliasedSymbol(symbol, ctx.checker);
  if (!resolvedSymbol) {
    return undefined;
  }

  const bound = bindings.get(resolvedSymbol);
  if (bound) {
    return bound;
  }

  const cached = ctx.symbolResourceCache.get(resolvedSymbol);
  if (cached !== undefined) {
    return cached ?? undefined;
  }

  ctx.symbolResourceCache.set(resolvedSymbol, null);

  for (const declaration of resolvedSymbol.declarations ?? []) {
    const initializer = resolveSymbolInitializerExpression(declaration);
    if (!initializer) {
      continue;
    }

    const resource = resolveResourceFromExpression(initializer, ctx, bindings);
    if (resource) {
      ctx.symbolResourceCache.set(resolvedSymbol, resource);
      return resource;
    }
  }

  ctx.symbolResourceCache.set(resolvedSymbol, null);
  return undefined;
}

function resolveSymbolInitializerExpression(
  declaration: ts.Declaration,
): ts.Expression | undefined {
  if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
    return declaration.initializer;
  }

  if (ts.isPropertyAssignment(declaration)) {
    return declaration.initializer;
  }

  if (
    (ts.isPropertyAccessExpression(declaration) ||
      ts.isElementAccessExpression(declaration) ||
      ts.isIdentifier(declaration)) &&
    ts.isBinaryExpression(declaration.parent) &&
    declaration.parent.left === declaration &&
    declaration.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    return declaration.parent.right;
  }

  return undefined;
}

function isColumnsProjection(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(unwrapped)) {
    return unwrapped.name.text === "columns";
  }
  if (ts.isElementAccessExpression(unwrapped)) {
    return isColumnsProjection(unwrapped.expression);
  }
  return false;
}

function resolveResourceFromExpression(
  expression: ts.Expression,
  ctx: AnalysisContext,
  bindings: Map<ts.Symbol, ResourceRef>,
): ResourceRef | undefined {
  const unwrapped = unwrapExpression(expression);

  if (ts.isNewExpression(unwrapped)) {
    return resolveResourceFromNewExpression(unwrapped, ctx);
  }

  if (
    ts.isTaggedTemplateExpression(unwrapped) &&
    isSqlTag(unwrapped.tag, ctx.checker)
  ) {
    const inferred = inferResourcesFromSqlTemplate(unwrapped.template, ctx);
    if (inferred.length === 1) {
      return inferred[0];
    }
  }

  if (ts.isCallExpression(unwrapped)) {
    const calleeExpression = unwrapCallTargetExpression(unwrapped.expression);
    if (isSqlTag(calleeExpression as ts.LeftHandSideExpression, ctx.checker)) {
      const inferred = inferResourcesFromSqlCallArguments(
        unwrapped.arguments,
        ctx,
      );
      if (inferred.length === 1) {
        return inferred[0];
      }
    }
  }

  if (ts.isIdentifier(unwrapped)) {
    return resolveResourceFromSymbol(
      ctx.checker.getSymbolAtLocation(unwrapped),
      ctx,
      bindings,
    );
  }

  if (ts.isPropertyAccessExpression(unwrapped)) {
    const base = resolveResourceFromExpression(
      unwrapped.expression,
      ctx,
      bindings,
    );
    if (
      base?.kind === "MaterializedView" &&
      unwrapped.name.text === "targetTable"
    ) {
      if (base.targetTableId) {
        return { kind: "Table", id: base.targetTableId };
      }
    }
    if (base?.kind === "IngestPipeline") {
      if (unwrapped.name.text === "stream" && base.streamId) {
        return { kind: "Topic", id: base.streamId };
      }
      if (unwrapped.name.text === "table" && base.tableId) {
        return { kind: "Table", id: base.tableId };
      }
    }
    if (base?.kind === "Table" && unwrapped.name.text === "columns") {
      return base;
    }
    if (base?.kind === "Table" && isColumnsProjection(unwrapped.expression)) {
      return base;
    }

    return resolveResourceFromSymbol(
      ctx.checker.getSymbolAtLocation(unwrapped),
      ctx,
      bindings,
    );
  }

  if (ts.isElementAccessExpression(unwrapped)) {
    const base = resolveResourceFromExpression(
      unwrapped.expression,
      ctx,
      bindings,
    );
    if (base) {
      return base;
    }
    return resolveResourceFromSymbol(
      ctx.checker.getSymbolAtLocation(unwrapped),
      ctx,
      bindings,
    );
  }

  return undefined;
}

function toSignature(
  ref: ResourceRef,
): InfrastructureSignatureJson | undefined {
  switch (ref.kind) {
    case "Table":
      return { kind: "Table", id: ref.id };
    case "Topic":
      return { kind: "Topic", id: ref.id };
    case "View":
      return { kind: "View", id: ref.id };
    case "SqlResource":
      return { kind: "SqlResource", id: ref.id };
    case "MaterializedView":
      if (ref.targetTableId) {
        return { kind: "Table", id: ref.targetTableId };
      }
      return { kind: "MaterializedView", id: ref.id };
    case "IngestPipeline":
      // Intentional: IngestPipeline is not a standalone infra node. It must be
      // decomposed through `.stream` or `.table` property access first.
      return undefined;
    default:
      return undefined;
  }
}

function getFunctionLikeDeclarations(
  symbol: ts.Symbol | undefined,
  ctx: AnalysisContext,
): ts.FunctionLikeDeclaration[] {
  const resolvedSymbol = resolveAliasedSymbol(symbol, ctx.checker);
  if (!resolvedSymbol) {
    return [];
  }

  const cached = ctx.functionCache.get(resolvedSymbol);
  if (cached) {
    return cached;
  }

  const declarations: ts.FunctionLikeDeclaration[] = [];
  for (const declaration of resolvedSymbol.declarations ?? []) {
    if (
      ts.isFunctionDeclaration(declaration) ||
      ts.isMethodDeclaration(declaration) ||
      ts.isGetAccessorDeclaration(declaration) ||
      ts.isSetAccessorDeclaration(declaration)
    ) {
      declarations.push(declaration);
      continue;
    }
    if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
      const initializer = unwrapExpression(declaration.initializer);
      if (
        ts.isArrowFunction(initializer) ||
        ts.isFunctionExpression(initializer)
      ) {
        declarations.push(initializer);
        continue;
      }
      if (
        ts.isIdentifier(initializer) ||
        ts.isPropertyAccessExpression(initializer)
      ) {
        declarations.push(
          ...getFunctionLikeDeclarations(
            ctx.checker.getSymbolAtLocation(initializer),
            ctx,
          ),
        );
      }
    }
    if (ts.isPropertyAssignment(declaration)) {
      const initializer = unwrapExpression(declaration.initializer);
      if (
        ts.isArrowFunction(initializer) ||
        ts.isFunctionExpression(initializer)
      ) {
        declarations.push(initializer);
      }
    }
  }

  ctx.functionCache.set(resolvedSymbol, declarations);
  return declarations;
}

function isSqlTag(
  tag: ts.LeftHandSideExpression,
  checker: ts.TypeChecker,
): boolean {
  const unwrapped = unwrapExpression(tag);
  if (ts.isIdentifier(unwrapped) && unwrapped.text === "sql") {
    return true;
  }
  if (
    ts.isPropertyAccessExpression(unwrapped) &&
    unwrapped.name.text === "sql"
  ) {
    return true;
  }
  const symbol = resolveAliasedSymbol(
    checker.getSymbolAtLocation(unwrapped),
    checker,
  );
  return symbol?.name === "sql";
}

function isUserCodeFunction(fn: ts.FunctionLikeDeclaration): boolean {
  const fileName = path
    .resolve(fn.getSourceFile().fileName)
    .replace(/\\/g, "/");
  const cwd = path.resolve(process.cwd()).replace(/\\/g, "/");
  return (
    (fileName === cwd || fileName.startsWith(`${cwd}/`)) &&
    !fileName.includes("/node_modules/")
  );
}

function functionIdentity(fn: ts.FunctionLikeDeclaration): string {
  const source = fn.getSourceFile().fileName;
  return `${source}:${fn.pos}`;
}

function bindingIdentityForFunction(
  fn: ts.FunctionLikeDeclaration,
  bindings: Map<ts.Symbol, ResourceRef>,
  checker: ts.TypeChecker,
): string {
  const parts: string[] = [];
  for (const parameter of fn.parameters) {
    const symbol = resolveAliasedSymbol(
      checker.getSymbolAtLocation(parameter.name),
      checker,
    );
    if (!symbol) {
      continue;
    }
    const bound = bindings.get(symbol);
    if (!bound) {
      continue;
    }
    if (bound.kind === "IngestPipeline") {
      continue;
    }
    const signature = toSignature(bound);
    if (!signature) {
      continue;
    }
    parts.push(`${symbol.name}:${signature.kind}:${signature.id}`);
  }
  parts.sort();
  return parts.join("|");
}

const API_HELPER_IDENTIFIERS = new Set(["ApiHelpers", "ConsumptionHelpers"]);

function isApiHelperObjectExpression(
  expression: ts.Expression,
  ctx: AnalysisContext,
  visitedSymbols = new Set<ts.Symbol>(),
): boolean {
  const unwrapped = unwrapExpression(expression);

  if (ts.isIdentifier(unwrapped)) {
    if (API_HELPER_IDENTIFIERS.has(unwrapped.text)) {
      return true;
    }

    const symbol = resolveAliasedSymbol(
      ctx.checker.getSymbolAtLocation(unwrapped),
      ctx.checker,
    );
    if (!symbol || visitedSymbols.has(symbol)) {
      return false;
    }
    visitedSymbols.add(symbol);

    if (API_HELPER_IDENTIFIERS.has(symbol.name)) {
      return true;
    }

    for (const declaration of symbol.declarations ?? []) {
      if (ts.isImportSpecifier(declaration)) {
        const importedName =
          declaration.propertyName?.text ?? declaration.name.text;
        if (API_HELPER_IDENTIFIERS.has(importedName)) {
          return true;
        }
      }

      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        if (
          isApiHelperObjectExpression(
            declaration.initializer,
            ctx,
            visitedSymbols,
          )
        ) {
          return true;
        }
      }

      if (ts.isPropertyAssignment(declaration)) {
        if (
          isApiHelperObjectExpression(
            declaration.initializer,
            ctx,
            visitedSymbols,
          )
        ) {
          return true;
        }
      }
    }

    return false;
  }

  if (ts.isPropertyAccessExpression(unwrapped)) {
    if (API_HELPER_IDENTIFIERS.has(unwrapped.name.text)) {
      return true;
    }
    return isApiHelperObjectExpression(
      unwrapped.expression,
      ctx,
      visitedSymbols,
    );
  }

  if (ts.isElementAccessExpression(unwrapped)) {
    return isApiHelperObjectExpression(
      unwrapped.expression,
      ctx,
      visitedSymbols,
    );
  }

  return false;
}

function analyzeFunctionGraph(
  roots: ts.FunctionLikeDeclaration[],
  ctx: AnalysisContext,
): DependencySignatures {
  const pulls = new Map<string, InfrastructureSignatureJson>();
  const pushes = new Map<string, InfrastructureSignatureJson>();
  const visited = new Set<string>();

  const addPull = (signature: InfrastructureSignatureJson | undefined) => {
    if (!signature) {
      return;
    }
    pulls.set(`${signature.kind}:${signature.id}`, signature);
  };

  const addPush = (signature: InfrastructureSignatureJson | undefined) => {
    if (!signature) {
      return;
    }
    pushes.set(`${signature.kind}:${signature.id}`, signature);
  };

  const visitFunction = (
    fn: ts.FunctionLikeDeclaration,
    bindings: Map<ts.Symbol, ResourceRef>,
  ) => {
    const key = `${functionIdentity(fn)}|${bindingIdentityForFunction(fn, bindings, ctx.checker)}`;
    if (visited.has(key)) {
      return;
    }
    visited.add(key);

    const visitNode = (node: ts.Node) => {
      if (
        ts.isTaggedTemplateExpression(node) &&
        isSqlTag(node.tag, ctx.checker)
      ) {
        for (const inferred of inferResourcesFromSqlTemplate(
          node.template,
          ctx,
        )) {
          addPull(toSignature(inferred));
        }

        const template = node.template;
        if (ts.isTemplateExpression(template)) {
          for (const span of template.templateSpans) {
            const ref = resolveResourceFromExpression(
              span.expression,
              ctx,
              bindings,
            );
            const signature = ref ? toSignature(ref) : undefined;
            addPull(signature);
          }
        }
      }

      if (ts.isCallExpression(node)) {
        const calleeExpression = unwrapCallTargetExpression(node.expression);

        if (
          isSqlTag(calleeExpression as ts.LeftHandSideExpression, ctx.checker)
        ) {
          for (const inferred of inferResourcesFromSqlCallArguments(
            node.arguments,
            ctx,
          )) {
            addPull(toSignature(inferred));
          }

          for (const arg of node.arguments) {
            const ref = resolveResourceFromExpression(arg, ctx, bindings);
            const signature = ref ? toSignature(ref) : undefined;
            addPull(signature);
          }
        }

        if (ts.isPropertyAccessExpression(calleeExpression)) {
          const methodName = calleeExpression.name.text;

          if (
            methodName === "table" &&
            isApiHelperObjectExpression(calleeExpression.expression, ctx)
          ) {
            const tableName = resolveStaticString(node.arguments?.[0], ctx);
            if (tableName) {
              addPull({
                kind: "Table",
                id: resolveTableId(tableName, undefined, ctx.registryIndex),
              });
            }
          }

          const ref = resolveResourceFromExpression(
            calleeExpression.expression,
            ctx,
            bindings,
          );
          if (ref) {
            const signature = toSignature(ref);
            if (signature) {
              if (WRITE_METHODS.has(methodName)) {
                addPush(signature);
              } else {
                // Heuristic: any non-write resource method call counts as a read.
                // This may classify utility calls like `toString`/`valueOf` as pulls,
                // but it keeps lineage inference conservative for current SDK usage.
                addPull(signature);
              }
            }
          }
        }

        const calleeSymbol = ctx.checker.getSymbolAtLocation(calleeExpression);
        const callees = getFunctionLikeDeclarations(calleeSymbol, ctx).filter(
          isUserCodeFunction,
        );
        for (const callee of callees) {
          const nextBindings = new Map<ts.Symbol, ResourceRef>(bindings);
          for (let i = 0; i < callee.parameters.length; i++) {
            const param = callee.parameters[i];
            if (!node.arguments || i >= node.arguments.length) {
              continue;
            }
            const paramSymbol = resolveAliasedSymbol(
              ctx.checker.getSymbolAtLocation(param.name),
              ctx.checker,
            );
            if (!paramSymbol) {
              continue;
            }
            const argRef = resolveResourceFromExpression(
              node.arguments[i],
              ctx,
              bindings,
            );
            if (argRef) {
              nextBindings.set(paramSymbol, argRef);
            }
          }
          visitFunction(callee, nextBindings);
        }
      }

      ts.forEachChild(node, visitNode);
    };

    if (fn.body) {
      visitNode(fn.body);
    }
  };

  for (const root of roots) {
    if (!isUserCodeFunction(root)) {
      continue;
    }
    visitFunction(root, new Map<ts.Symbol, ResourceRef>());
  }

  return {
    pullsDataFrom: [...pulls.values()],
    pushesDataTo: [...pushes.values()],
  };
}

function resolveFunctionNodesFromExpression(
  expression: ts.Expression | undefined,
  ctx: AnalysisContext,
): ts.FunctionLikeDeclaration[] {
  if (!expression) {
    return [];
  }
  const unwrapped = unwrapExpression(expression);
  if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
    return [unwrapped];
  }
  if (ts.isIdentifier(unwrapped) || ts.isPropertyAccessExpression(unwrapped)) {
    return getFunctionLikeDeclarations(
      ctx.checker.getSymbolAtLocation(unwrapped),
      ctx,
    );
  }
  return [];
}

function resolveTaskExpression(
  expression: ts.Expression | undefined,
  ctx: AnalysisContext,
): ts.NewExpression | undefined {
  if (!expression) {
    return undefined;
  }

  const unwrapped = unwrapExpression(expression);
  const cacheKey = `${unwrapped.getSourceFile().fileName}:${unwrapped.pos}`;
  const cached = ctx.taskExpressionCache.get(cacheKey);
  if (cached !== undefined) {
    return cached ?? undefined;
  }

  ctx.taskExpressionCache.set(cacheKey, null);

  if (ts.isNewExpression(unwrapped)) {
    const ctor = constructorNameFromNewExpression(
      unwrapped.expression,
      ctx.checker,
    );
    if (ctor === "Task") {
      ctx.taskExpressionCache.set(cacheKey, unwrapped);
      return unwrapped;
    }
  }

  if (ts.isIdentifier(unwrapped) || ts.isPropertyAccessExpression(unwrapped)) {
    const symbol = resolveAliasedSymbol(
      ctx.checker.getSymbolAtLocation(unwrapped),
      ctx.checker,
    );
    for (const declaration of symbol?.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const resolved = resolveTaskExpression(declaration.initializer, ctx);
        if (resolved) {
          ctx.taskExpressionCache.set(cacheKey, resolved);
          return resolved;
        }
      }
    }
  }

  return undefined;
}

function collectTaskFunctions(
  taskExpression: ts.Expression | undefined,
  ctx: AnalysisContext,
  visitedTasks: Set<string>,
): ts.FunctionLikeDeclaration[] {
  const task = resolveTaskExpression(taskExpression, ctx);
  if (!task) {
    return [];
  }

  const taskKey = `${task.getSourceFile().fileName}:${task.pos}`;
  if (visitedTasks.has(taskKey)) {
    return [];
  }
  visitedTasks.add(taskKey);

  const configExpression = task.arguments?.[1];
  const configObject = resolveObjectLiteralExpression(configExpression, ctx);
  if (!configObject) {
    return [];
  }

  const functions: ts.FunctionLikeDeclaration[] = [];
  functions.push(
    ...resolveFunctionNodesFromExpression(
      getObjectPropertyExpression(configObject, "run"),
      ctx,
    ),
  );
  functions.push(
    ...resolveFunctionNodesFromExpression(
      getObjectPropertyExpression(configObject, "onCancel"),
      ctx,
    ),
  );

  const onComplete = getObjectPropertyExpression(configObject, "onComplete");
  if (onComplete) {
    const arrayLiteral = unwrapExpression(onComplete);
    if (ts.isArrayLiteralExpression(arrayLiteral)) {
      for (const element of arrayLiteral.elements) {
        if (ts.isExpression(element)) {
          functions.push(...collectTaskFunctions(element, ctx, visitedTasks));
        }
      }
    }
  }

  return functions;
}

function collectAnalysisFiles(registry: RegistryLike): string[] {
  const files = new Set<string>();
  let requiresFallbackScan = false;

  const uniqueApis = new Set<any>();
  for (const api of registry.apis.values()) {
    uniqueApis.add(api);
  }
  for (const api of uniqueApis) {
    const sourceFile = api?.metadata?.source?.file;
    if (
      typeof sourceFile === "string" &&
      fs.existsSync(sourceFile) &&
      isSourceFilePath(sourceFile)
    ) {
      files.add(path.resolve(sourceFile));
    } else {
      requiresFallbackScan = true;
    }
  }

  registry.workflows.forEach((workflow: any) => {
    const sourceFile = workflow?.sourceFile;
    if (
      typeof sourceFile === "string" &&
      fs.existsSync(sourceFile) &&
      isSourceFilePath(sourceFile)
    ) {
      files.add(path.resolve(sourceFile));
    } else {
      requiresFallbackScan = true;
    }
  });

  registry.webApps.forEach((webApp: any) => {
    const sourceFile = webApp?.sourceFile;
    if (
      typeof sourceFile === "string" &&
      fs.existsSync(sourceFile) &&
      isSourceFilePath(sourceFile)
    ) {
      files.add(path.resolve(sourceFile));
    } else {
      requiresFallbackScan = true;
    }
  });

  if (files.size === 0 || requiresFallbackScan) {
    const appDir = path.resolve(process.cwd(), getSourceDir());
    for (const file of findSourceFiles(appDir)) {
      files.add(file);
    }
  }

  return [...files];
}

function loadCompilerOptions(rootNames: string[]): {
  rootNames: string[];
  options: ts.CompilerOptions;
} {
  const fallback: ts.CompilerOptions = {
    allowJs: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    jsx: ts.JsxEmit.Preserve,
    skipLibCheck: true,
  };

  const configPath = ts.findConfigFile(
    process.cwd(),
    ts.sys.fileExists,
    "tsconfig.json",
  );
  if (!configPath) {
    return { rootNames, options: fallback };
  }

  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    return { rootNames, options: fallback };
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    path.dirname(configPath),
  );
  const normalizedRoots = [
    ...new Set(rootNames.map((file) => path.resolve(file))),
  ];

  return {
    rootNames: normalizedRoots,
    options: { ...fallback, ...parsed.options },
  };
}

function createNameResolutionContext(checker: ts.TypeChecker): AnalysisContext {
  return {
    checker,
    registryIndex: {
      tableIdsByName: new Map(),
      topicIdsByName: new Map(),
      tableIds: new Set(),
      topicIds: new Set(),
    },
    symbolResourceCache: new Map(),
    taskExpressionCache: new Map(),
    functionCache: new Map(),
  };
}

function collectLineageRootEntries(
  program: ts.Program,
  checker: ts.TypeChecker,
): {
  apiEntries: Map<string, ts.Expression>;
  workflowEntries: Map<string, ts.Expression>;
  webAppEntries: Map<string, ts.Expression>;
} {
  const apiEntries = new Map<string, ts.Expression>();
  const workflowEntries = new Map<string, ts.Expression>();
  const webAppEntries = new Map<string, ts.Expression>();
  const tempCtx = createNameResolutionContext(checker);

  const setIfNew = (
    entries: Map<string, ts.Expression>,
    key: string | undefined,
    expression: ts.Expression,
  ) => {
    if (!key || entries.has(key)) {
      return;
    }
    entries.set(key, expression);
  };

  const visit = (node: ts.Node) => {
    if (
      ts.isNewExpression(node) &&
      node.arguments &&
      node.arguments.length >= 2
    ) {
      const ctor = constructorNameFromNewExpression(node.expression, checker);
      if (ctor === "Api" || ctor === "ConsumptionApi") {
        const name = resolveStaticString(node.arguments[0], tempCtx);
        const config = resolveObjectLiteralExpression(
          node.arguments[2],
          tempCtx,
        );
        const version =
          config ?
            resolveStaticString(
              getObjectPropertyExpression(config, "version"),
              tempCtx,
            )
          : undefined;
        const key =
          name ?
            version ? `${name}:${version}`
            : name
          : undefined;
        setIfNew(apiEntries, key, node.arguments[1]);
      } else if (ctor === "Workflow") {
        const key = resolveStaticString(node.arguments[0], tempCtx);
        setIfNew(workflowEntries, key, node.arguments[1]);
      } else if (ctor === "WebApp") {
        const key = resolveStaticString(node.arguments[0], tempCtx);
        setIfNew(webAppEntries, key, node.arguments[1]);
      }
    }
    ts.forEachChild(node, visit);
  };

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.fileName.includes("/node_modules/")) {
      continue;
    }
    visit(sourceFile);
  }

  return { apiEntries, workflowEntries, webAppEntries };
}

function resolveWebAppRootFunctions(
  expression: ts.Expression | undefined,
  ctx: AnalysisContext,
): ts.FunctionLikeDeclaration[] {
  const roots = resolveFunctionNodesFromExpression(expression, ctx);
  const objectLiteral = resolveObjectLiteralExpression(expression, ctx);
  if (!objectLiteral) {
    return roots;
  }

  const deduped = new Map<string, ts.FunctionLikeDeclaration>();
  for (const root of roots) {
    deduped.set(functionIdentity(root), root);
  }

  for (const propertyName of ["handle", "callback", "routing"]) {
    const propertyExpression = getObjectPropertyExpression(
      objectLiteral,
      propertyName,
    );
    const propertyFunctions = resolveFunctionNodesFromExpression(
      propertyExpression,
      ctx,
    );
    for (const fn of propertyFunctions) {
      deduped.set(functionIdentity(fn), fn);
    }
  }

  return [...deduped.values()];
}

export function analyzeRegistryLineage(
  registry: RegistryLike,
): DependencyAnalysisResult {
  if (
    registry.apis.size === 0 &&
    registry.workflows.size === 0 &&
    registry.webApps.size === 0
  ) {
    return createEmptyResult();
  }

  const files = collectAnalysisFiles(registry);
  if (files.length === 0) {
    return createEmptyResult();
  }

  const { rootNames, options } = loadCompilerOptions(files);
  const program = ts.createProgram({
    rootNames,
    options,
  });
  const checker = program.getTypeChecker();

  const ctx: AnalysisContext = {
    checker,
    registryIndex: buildRegistryIndex(registry),
    symbolResourceCache: new Map<ts.Symbol, ResourceRef | null>(),
    taskExpressionCache: new Map<string, ts.NewExpression | null>(),
    functionCache: new Map<ts.Symbol, ts.FunctionLikeDeclaration[]>(),
  };

  const { apiEntries, workflowEntries, webAppEntries } =
    collectLineageRootEntries(program, checker);

  const apiByKey = new Map<string, DependencySignatures>();
  const seenApiKeys = new Set<string>();
  registry.apis.forEach((api: any) => {
    const key =
      api?.config?.version ? `${api.name}:${api.config.version}` : api.name;
    if (!key || seenApiKeys.has(key)) {
      return;
    }
    seenApiKeys.add(key);

    const handlerExpression = apiEntries.get(key);
    if (!handlerExpression) {
      apiByKey.set(key, { pullsDataFrom: [], pushesDataTo: [] });
      return;
    }

    const roots = resolveFunctionNodesFromExpression(handlerExpression, ctx);
    apiByKey.set(key, analyzeFunctionGraph(roots, ctx));
  });

  const workflowByName = new Map<string, DependencySignatures>();
  registry.workflows.forEach((workflow: any, workflowName: string) => {
    const configExpression = workflowEntries.get(workflowName);
    if (!configExpression) {
      workflowByName.set(workflowName, { pullsDataFrom: [], pushesDataTo: [] });
      return;
    }
    const configObject = resolveObjectLiteralExpression(configExpression, ctx);
    const startingTaskExpression =
      configObject ?
        getObjectPropertyExpression(configObject, "startingTask")
      : undefined;
    const roots = collectTaskFunctions(
      startingTaskExpression,
      ctx,
      new Set<string>(),
    );
    workflowByName.set(workflowName, analyzeFunctionGraph(roots, ctx));
  });

  const webAppByName = new Map<string, DependencySignatures>();
  registry.webApps.forEach((webApp: any, webAppName: string) => {
    const handlerExpression = webAppEntries.get(webAppName);
    if (!handlerExpression) {
      webAppByName.set(webAppName, { pullsDataFrom: [], pushesDataTo: [] });
      return;
    }

    const roots = resolveWebAppRootFunctions(handlerExpression, ctx);
    webAppByName.set(webAppName, analyzeFunctionGraph(roots, ctx));
  });

  return { apiByKey, workflowByName, webAppByName };
}
