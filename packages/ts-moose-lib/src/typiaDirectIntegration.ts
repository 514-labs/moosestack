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
import { MetadataCollection } from "typia/lib/factories/MetadataCollection";
import { MetadataFactory } from "typia/lib/factories/MetadataFactory";
import { LiteralFactory } from "typia/lib/factories/LiteralFactory";
import { ITypiaContext } from "typia/lib/transformers/ITypiaContext";

/**
 * Context for direct typia code generation
 */
export interface TypiaDirectContext {
  program: ts.Program;
  checker: ts.TypeChecker;
  transformer: ts.TransformationContext;
  importer: ImportProgrammer;
  modulo: ts.LeftHandSideExpression;
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
): TypiaDirectContext => {
  const importer = new ImportProgrammer({
    internalPrefix: "typia_transform__",
  });

  return {
    program,
    checker: program.getTypeChecker(),
    transformer,
    importer,
    modulo: createSyntheticModulo(),
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
 * Generates JSON schemas directly using typia's JsonSchemasProgrammer
 */
export const generateJsonSchemas = (
  ctx: TypiaDirectContext,
  type: ts.Type,
): ts.Expression => {
  // Analyze metadata from the type
  const metadataResult = MetadataFactory.analyze({
    checker: ctx.checker,
    transformer: ctx.transformer,
    options: {
      absorb: false,
      constant: true,
      escape: true,
      validate: JsonSchemasProgrammer.validate,
    },
    collection: new MetadataCollection({
      replace: MetadataCollection.replace,
    }),
    type,
  });

  if (!metadataResult.success) {
    // Fall back to empty schema on error
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

/**
 * Gets all import statements that typia's code generation requires
 */
export const getTypiaImports = (ctx: TypiaDirectContext): ts.Statement[] => {
  return ctx.importer.toStatements();
};
