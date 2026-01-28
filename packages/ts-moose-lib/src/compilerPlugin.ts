import ts, { factory } from "typescript";
import {
  createTransformer,
  type TransformContext,
} from "./compilerPluginHelper";
import {
  isNewMooseResourceWithTypeParam,
  transformNewMooseResource,
} from "./dmv2/dataModelMetadata";
import { isApiV2, transformApiV2 } from "./consumption-apis/typiaValidation";
import { createTypiaContext } from "./typiaDirectIntegration";
import { compilerLog } from "./commons";

/**
 * Applies the appropriate transformation based on node type
 */
const applyTransformation = (
  node: ts.Node,
  ctx: TransformContext,
): ts.Node | undefined => {
  if (isApiV2(node, ctx.typeChecker)) {
    compilerLog("[CompilerPlugin] Found API v2, transforming...");
    return transformApiV2(node, ctx.typeChecker, ctx);
  }

  if (isNewMooseResourceWithTypeParam(node, ctx.typeChecker)) {
    compilerLog(
      "[CompilerPlugin] Found Moose resource with type param, transforming...",
    );
    return transformNewMooseResource(node, ctx.typeChecker, ctx);
  }

  return undefined;
};

/**
 * Main transformation function that processes TypeScript source files
 */
const transform =
  (ctx: TransformContext) =>
  (transformationContext: ts.TransformationContext) =>
  (sourceFile: ts.SourceFile): ts.SourceFile => {
    compilerLog(
      `\n[CompilerPlugin] ========== Processing file: ${sourceFile.fileName} ==========`,
    );
    const typiaContext = createTypiaContext(
      ctx.program,
      transformationContext,
      sourceFile,
    );

    const ctxWithTransformer: TransformContext = {
      ...ctx,
      transformer: transformationContext,
      typiaContext,
    };

    const visitNode = (node: ts.Node): ts.Node => {
      const transformed = applyTransformation(node, ctxWithTransformer);
      const result = transformed ?? node;
      return ts.visitEachChild(result, visitNode, transformationContext);
    };

    const transformedSourceFile = ts.visitEachChild(
      sourceFile,
      visitNode,
      transformationContext,
    );

    // Add imports from ImportProgrammer (for direct typia integration)
    const typiaImports = typiaContext.importer.toStatements();
    if (typiaImports.length === 0) {
      compilerLog(
        `[CompilerPlugin] ========== Completed processing ${sourceFile.fileName} (no import needed) ==========\n`,
      );
      return transformedSourceFile;
    }

    compilerLog(
      `[CompilerPlugin] ========== Completed processing ${sourceFile.fileName} (with import) ==========\n`,
    );
    return factory.updateSourceFile(
      transformedSourceFile,
      factory.createNodeArray([
        ...typiaImports,
        ...transformedSourceFile.statements,
      ]),
    );
  };

export default createTransformer(transform);
