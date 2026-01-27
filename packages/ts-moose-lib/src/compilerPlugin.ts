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

/**
 * Applies the appropriate transformation based on node type
 */
const applyTransformation = (
  node: ts.Node,
  ctx: TransformContext,
): ts.Node | undefined => {
  if (isApiV2(node, ctx.typeChecker)) {
    return transformApiV2(node, ctx.typeChecker, ctx);
  }

  if (isNewMooseResourceWithTypeParam(node, ctx.typeChecker)) {
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
      return transformedSourceFile;
    }

    return factory.updateSourceFile(
      transformedSourceFile,
      factory.createNodeArray([
        ...typiaImports,
        ...transformedSourceFile.statements,
      ]),
    );
  };

export default createTransformer(transform);
