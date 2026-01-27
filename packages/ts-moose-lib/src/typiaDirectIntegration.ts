/**
 * Direct integration with typia's internal programmers
 * This bypasses the need for typia's transformer plugin by directly calling
 * typia's code generation functions.
 *
 * IMPORTANT: We import from typia/lib (compiled JS) not typia/src (TypeScript)
 * to avoid issues with Node's type stripping in node_modules.
 */
import ts from "typescript";
import { ImportProgrammer } from "typia/lib/programmers/ImportProgrammer";
import { ValidateProgrammer } from "typia/lib/programmers/ValidateProgrammer";
import { IsProgrammer } from "typia/lib/programmers/IsProgrammer";
import { AssertProgrammer } from "typia/lib/programmers/AssertProgrammer";
import { JsonSchemasProgrammer } from "typia/lib/programmers/json/JsonSchemasProgrammer";
import { HttpAssertQueryProgrammer } from "typia/lib/programmers/http/HttpAssertQueryProgrammer";
import { MetadataCollection } from "typia/lib/factories/MetadataCollection";
import { MetadataFactory } from "typia/lib/factories/MetadataFactory";
import { LiteralFactory } from "typia/lib/factories/LiteralFactory";
import { ITypiaContext } from "typia/lib/transformers/ITypiaContext";
import { avoidTypiaNameClash } from "./compilerPluginHelper";

/**
 * Context for direct typia code generation
 */
export interface TypiaDirectContext {
  program: ts.Program;
  checker: ts.TypeChecker;
  transformer: ts.TransformationContext;
  importer: ImportProgrammer;
  modulo: ts.LeftHandSideExpression;
  sourceFile: ts.SourceFile;
}

/**
 * Creates a synthetic identifier with a patched getText method.
 * Typia's programmers call modulo.getText() which normally requires
 * the node to be attached to a source file. We patch the method directly.
 */
const createSyntheticModulo = (): ts.LeftHandSideExpression => {
  const identifier = ts.factory.createIdentifier("typia") as ts.Identifier & {
    getText: () => string;
  };

  // Monkey-patch getText to return "typia" directly
  identifier.getText = () => "typia";

  return identifier;
};

/**
 * Creates a typia context for direct code generation
 */
export const createTypiaContext = (
  program: ts.Program,
  transformer: ts.TransformationContext,
  sourceFile: ts.SourceFile,
): TypiaDirectContext => {
  const importer = new ImportProgrammer({
    internalPrefix: avoidTypiaNameClash,
  });

  return {
    program,
    checker: program.getTypeChecker(),
    transformer,
    importer,
    modulo: createSyntheticModulo(),
    sourceFile,
  };
};

/**
 * Converts our context to typia's internal context format
 */
const toTypiaContext = (ctx: TypiaDirectContext): ITypiaContext => ({
  program: ctx.program,
  compilerOptions: ctx.program.getCompilerOptions(),
  checker: ctx.checker,
  printer: ts.createPrinter(),
  options: {},
  transformer: ctx.transformer,
  importer: ctx.importer,
  extras: {
    addDiagnostic: () => 0, // Swallow diagnostics - we handle errors ourselves
  },
});

/**
 * Generates a validate function directly using typia's ValidateProgrammer
 */
export const generateValidateFunction = (
  ctx: TypiaDirectContext,
  type: ts.Type,
  typeName?: string,
): ts.Expression => {
  const typiaCtx = toTypiaContext(ctx);
  // Don't sanitize for validation - pass original type
  // Validation works with runtime values, not type metadata

  return ValidateProgrammer.write({
    context: typiaCtx,
    modulo: ctx.modulo,
    type,
    name: typeName,
    config: { equals: false },
  });
};

/**
 * Generates an is function directly using typia's IsProgrammer
 */
export const generateIsFunction = (
  ctx: TypiaDirectContext,
  type: ts.Type,
  typeName?: string,
): ts.Expression => {
  const typiaCtx = toTypiaContext(ctx);

  return IsProgrammer.write({
    context: typiaCtx,
    modulo: ctx.modulo,
    type,
    name: typeName,
    config: { equals: false },
  });
};

/**
 * Generates an assert function directly using typia's AssertProgrammer
 */
export const generateAssertFunction = (
  ctx: TypiaDirectContext,
  type: ts.Type,
  typeName?: string,
): ts.Expression => {
  const typiaCtx = toTypiaContext(ctx);

  return AssertProgrammer.write({
    context: typiaCtx,
    modulo: ctx.modulo,
    type,
    name: typeName,
    config: { equals: false, guard: false },
  });
};

/**
 * Generates an HTTP assert query function for validating URL query parameters
 * This is used by the Api class to validate incoming query parameters
 */
export const generateHttpAssertQueryFunction = (
  ctx: TypiaDirectContext,
  type: ts.Type,
  typeName?: string,
): ts.Expression => {
  const typiaCtx = toTypiaContext(ctx);

  return HttpAssertQueryProgrammer.write({
    context: typiaCtx,
    modulo: ctx.modulo,
    type,
    name: typeName,
  });
};

/**
 * Our custom ClickHouse type tags use properties starting with "_clickhouse_".
 * These need to be stripped before JSON schema generation because typia doesn't
 * recognize them as proper type tags.
 */
const isOurCustomTypeTag = (type: ts.Type): boolean => {
  const symbol = type.getSymbol();
  if (!symbol) return false;

  // Check if the type has a property starting with "_clickhouse_" or "_LowCardinality"
  const declarations = symbol.getDeclarations();
  if (!declarations || declarations.length === 0) return false;

  for (const decl of declarations) {
    if (ts.isTypeLiteralNode(decl) || ts.isInterfaceDeclaration(decl)) {
      for (const member of decl.members) {
        if (
          ts.isPropertySignature(member) &&
          member.name &&
          ts.isIdentifier(member.name)
        ) {
          const name = member.name.text;
          if (
            name.startsWith("_clickhouse_") ||
            name === "_LowCardinality" ||
            name === "typia.tag"
          ) {
            return true;
          }
        }
      }
    }
  }
  return false;
};

/**
 * Strips our custom type tags from an intersection type, returning the base type(s).
 * For example: `Date & ClickHousePrecision<3>` becomes `Date`
 */
const stripCustomTypeTagsFromType = (
  type: ts.Type,
  checker: ts.TypeChecker,
): ts.Type => {
  if (!type.isIntersection()) {
    return type;
  }

  // Filter out our custom type tags
  const filteredTypes = type.types.filter((t) => !isOurCustomTypeTag(t));

  if (filteredTypes.length === 0) {
    // All types were custom tags, return original
    return type;
  }

  if (filteredTypes.length === 1) {
    // Only one type left, recursively process it
    return stripCustomTypeTagsFromType(filteredTypes[0], checker);
  }

  // Multiple types remaining - this is still an intersection
  // TypeScript doesn't have a direct API to create intersection types,
  // so we'll use the first non-tag type
  return stripCustomTypeTagsFromType(filteredTypes[0], checker);
};

/**
 * Generates JSON schemas directly using typia's JsonSchemasProgrammer.
 *
 * Uses the same options as CheckerProgrammer (absorb: true, escape: false)
 * to handle our custom ClickHouse type tags that typia doesn't recognize.
 */
export const generateJsonSchemas = (
  ctx: TypiaDirectContext,
  type: ts.Type,
): ts.Expression => {
  // Strip our custom type tags from the top-level type
  const strippedType = stripCustomTypeTagsFromType(type, ctx.checker);

  // Use same options as CheckerProgrammer for consistency
  // Key: escape: false allows intersection handling without errors
  const metadataResult = MetadataFactory.analyze({
    checker: ctx.checker,
    transformer: ctx.transformer,
    options: {
      absorb: true,
      constant: true,
      escape: false, // Match CheckerProgrammer - this is key!
    },
    collection: new MetadataCollection({
      replace: MetadataCollection.replace,
    }),
    type: strippedType,
  });

  if (!metadataResult.success) {
    // Log errors for debugging but don't fail
    console.error("Metadata analysis failed:", metadataResult.errors);
    return ts.factory.createObjectLiteralExpression([]);
  }

  // Generate the JSON schema collection
  const collection = JsonSchemasProgrammer.write({
    version: "3.1",
    metadatas: [metadataResult.data],
  });

  // Convert the collection to an AST literal
  return ts.factory.createAsExpression(
    LiteralFactory.write(collection),
    ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
  );
};
