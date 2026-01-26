import ts, { factory } from "typescript";
import {
  avoidTypiaNameClash,
  replaceProgram,
  type TransformContext,
} from "./compilerPluginHelper";
import {
  isNewMooseResourceWithTypeParam,
  transformNewMooseResource,
} from "./dmv2/dataModelMetadata";
import {
  isCreateApi,
  isCreateApiV2,
  transformCreateApi,
  transformLegacyApi,
} from "./consumption-apis/typiaValidation";

/**
 * Creates the typia import statement to avoid name clashes
 */
export const createTypiaImport = () =>
  factory.createImportDeclaration(
    undefined,
    factory.createImportClause(
      false,
      factory.createIdentifier(avoidTypiaNameClash),
      undefined,
    ),
    factory.createStringLiteral("typia"),
    undefined,
  );

/**
 * Applies the appropriate transformation based on node type
 * Returns both the transformed node and whether a transformation occurred
 */
const applyTransformation = (
  node: ts.Node,
  ctx: TransformContext,
): { transformed: ts.Node; wasTransformed: boolean } => {
  if (isCreateApi(node, ctx.typeChecker)) {
    return {
      transformed: transformLegacyApi(node, ctx.typeChecker),
      wasTransformed: true,
    };
  }

  if (isCreateApiV2(node, ctx.typeChecker)) {
    return {
      transformed: transformCreateApi(node, ctx.typeChecker),
      wasTransformed: true,
    };
  }

  if (isNewMooseResourceWithTypeParam(node, ctx.typeChecker)) {
    return {
      transformed: transformNewMooseResource(node, ctx.typeChecker, ctx),
      wasTransformed: true,
    };
  }

  return { transformed: node, wasTransformed: false };
};

/**
 * Checks if typia import already exists in the source file
 */
const hasExistingTypiaImport = (sourceFile: ts.SourceFile): boolean => {
  return sourceFile.statements.some((stmt) => {
    if (
      !ts.isImportDeclaration(stmt) ||
      !ts.isStringLiteral(stmt.moduleSpecifier)
    ) {
      return false;
    }

    if (stmt.moduleSpecifier.text !== "typia") {
      return false;
    }

    // Check if it has our specific aliased import
    const importClause = stmt.importClause;
    if (
      importClause &&
      importClause.name &&
      importClause.name.text === avoidTypiaNameClash
    ) {
      return true;
    }

    return false;
  });
};

/**
 * Adds typia import to the source file if not already present
 */
const addTypiaImport = (sourceFile: ts.SourceFile): ts.SourceFile => {
  if (hasExistingTypiaImport(sourceFile)) {
    return sourceFile;
  }

  const statementsWithImport = factory.createNodeArray([
    createTypiaImport(),
    ...sourceFile.statements,
  ]);

  return factory.updateSourceFile(sourceFile, statementsWithImport);
};

/**
 * Main transformation function that processes TypeScript source files
 */
const transform =
  (ctx: TransformContext) =>
  (transformationContext: ts.TransformationContext) =>
  (sourceFile: ts.SourceFile): ts.SourceFile => {
    let hasTransformations = false;

    const visitNode = (node: ts.Node): ts.Node => {
      const { transformed, wasTransformed } = applyTransformation(node, ctx);

      if (wasTransformed) {
        hasTransformations = true;
      }

      return ts.visitEachChild(transformed, visitNode, transformationContext);
    };

    const transformedSourceFile = ts.visitEachChild(
      sourceFile,
      visitNode,
      transformationContext,
    );

    if (hasTransformations) {
      return addTypiaImport(transformedSourceFile);
    }

    return transformedSourceFile;
  };

export default replaceProgram(transform);
