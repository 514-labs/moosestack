import ts, { factory } from "typescript";
import { avoidTypiaNameClash, replaceProgram } from "./compilerPluginHelper";
import { compilerLog } from "./commons";
import {
  isNewMooseResourceWithTypeParam,
  transformNewMooseResource,
  isOlapTableFactoryCallWithTypeParam,
  transformOlapTableFactoryCall,
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
  typeChecker: ts.TypeChecker,
): { transformed: ts.Node; wasTransformed: boolean } => {
  if (isCreateApi(node, typeChecker)) {
    compilerLog("[CompilerPlugin] Found legacy API, transforming...");
    return {
      transformed: transformLegacyApi(node, typeChecker),
      wasTransformed: true,
    };
  }

  if (isCreateApiV2(node, typeChecker)) {
    compilerLog("[CompilerPlugin] Found API v2, transforming...");
    return {
      transformed: transformCreateApi(node, typeChecker),
      wasTransformed: true,
    };
  }

  if (isNewMooseResourceWithTypeParam(node, typeChecker)) {
    compilerLog(
      "[CompilerPlugin] Found Moose resource with type param, transforming...",
    );
    return {
      transformed: transformNewMooseResource(node, typeChecker),
      wasTransformed: true,
    };
  }

  if (isOlapTableFactoryCallWithTypeParam(node, typeChecker)) {
    compilerLog(
      "[CompilerPlugin] Found OlapTable static factory with type param, transforming...",
    );
    return {
      transformed: transformOlapTableFactoryCall(node, typeChecker),
      wasTransformed: true,
    };
  }

  return { transformed: node, wasTransformed: false };
};

/**
 * Checks if typia import already exists in the source file
 */
const hasExistingTypiaImport = (sourceFile: ts.SourceFile): boolean => {
  const hasImport = sourceFile.statements.some((stmt) => {
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
  compilerLog(
    `[CompilerPlugin] Checking for existing typia import (${avoidTypiaNameClash}) in ${sourceFile.fileName}: ${hasImport}`,
  );
  return hasImport;
};

/**
 * Adds typia import to the source file if transformations were applied
 */
const addTypiaImport = (sourceFile: ts.SourceFile): ts.SourceFile => {
  if (hasExistingTypiaImport(sourceFile)) {
    compilerLog(
      `[CompilerPlugin] Typia import already exists in ${sourceFile.fileName}, skipping...`,
    );
    return sourceFile;
  }

  compilerLog(`[CompilerPlugin] Adding typia import to ${sourceFile.fileName}`);
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
  (typeChecker: ts.TypeChecker) =>
  (_context: ts.TransformationContext) =>
  (sourceFile: ts.SourceFile): ts.SourceFile => {
    compilerLog(
      `\n[CompilerPlugin] ========== Processing file: ${sourceFile.fileName} ==========`,
    );

    let transformationCount = 0;
    let hasTypiaTransformations = false;

    const visitNode = (node: ts.Node): ts.Node => {
      // Apply transformation and check if it was transformed
      const { transformed, wasTransformed } = applyTransformation(
        node,
        typeChecker,
      );

      if (wasTransformed) {
        transformationCount++;
        hasTypiaTransformations = true;
        compilerLog(
          `[CompilerPlugin] Transformation #${transformationCount} applied at position ${node.pos}`,
        );
      }

      return ts.visitEachChild(transformed, visitNode, undefined);
    };

    const transformedSourceFile = ts.visitEachChild(
      sourceFile,
      visitNode,
      undefined,
    );

    compilerLog(
      `[CompilerPlugin] Total transformations applied: ${transformationCount}`,
    );

    // Use transformation tracking instead of scanning for typia references
    compilerLog(
      `[CompilerPlugin] Needs typia import: ${hasTypiaTransformations}`,
    );

    if (hasTypiaTransformations) {
      const result = addTypiaImport(transformedSourceFile);
      compilerLog(
        `[CompilerPlugin] ========== Completed processing ${sourceFile.fileName} (with import) ==========\n`,
      );
      return result;
    } else {
      compilerLog(
        `[CompilerPlugin] ========== Completed processing ${sourceFile.fileName} (no import needed) ==========\n`,
      );
      return transformedSourceFile;
    }
  };

export default replaceProgram(transform);
