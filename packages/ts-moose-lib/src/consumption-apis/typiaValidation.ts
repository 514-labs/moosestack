import ts, { factory, SyntaxKind } from "typescript";
import { isMooseFile, type TransformContext } from "../compilerPluginHelper";
import { toColumns } from "../dataModels/typeConvert";
import { parseAsAny } from "../dmv2/dataModelMetadata";
import {
  generateHttpAssertQueryFunction,
  generateJsonSchemas,
} from "../typiaDirectIntegration";

export const isApiV2 = (
  node: ts.Node,
  checker: ts.TypeChecker,
): node is ts.NewExpression => {
  if (!ts.isNewExpression(node)) {
    return false;
  }

  const declaration: ts.Declaration | undefined =
    checker.getResolvedSignature(node)?.declaration;
  if (!declaration || !isMooseFile(declaration.getSourceFile())) {
    return false;
  }

  const sym = checker.getSymbolAtLocation(node.expression);
  return sym?.name === "Api" || sym?.name === "ConsumptionApi";
};

export const transformApiV2 = (
  node: ts.NewExpression,
  checker: ts.TypeChecker,
  ctx: TransformContext,
): ts.Node => {
  if (!isApiV2(node, checker)) {
    return node;
  }

  if (!node.arguments || node.arguments.length < 2 || !node.typeArguments) {
    return node;
  }

  const typiaCtx = ctx.typiaContext;

  // Get both type parameters from Api<T, R>
  const typeNode = node.typeArguments[0];
  const responseTypeNode =
    node.typeArguments[1] ||
    factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);

  const inputType = checker.getTypeAtLocation(typeNode);
  const responseType = checker.getTypeAtLocation(responseTypeNode);

  // Get the handler function (second argument)
  const handlerFunc = node.arguments[1];

  // Generate the HTTP assert query function directly
  const assertQueryFunc = generateHttpAssertQueryFunction(typiaCtx, inputType);

  // Create a new handler function that includes validation
  const wrappedHandler = factory.createArrowFunction(
    undefined,
    undefined,
    [
      factory.createParameterDeclaration(
        undefined,
        undefined,
        factory.createIdentifier("params"),
        undefined,
        undefined,
        undefined,
      ),
      factory.createParameterDeclaration(
        undefined,
        undefined,
        factory.createIdentifier("utils"),
        undefined,
        undefined,
        undefined,
      ),
    ],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    factory.createBlock(
      [
        // const assertGuard = <generated http assert query function>
        factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                factory.createIdentifier("assertGuard"),
                undefined,
                undefined,
                assertQueryFunc,
              ),
            ],
            ts.NodeFlags.Const,
          ),
        ),
        // const searchParams = new URLSearchParams(params as any)
        factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                factory.createIdentifier("searchParams"),
                undefined,
                undefined,
                factory.createNewExpression(
                  factory.createIdentifier("URLSearchParams"),
                  undefined,
                  [
                    factory.createAsExpression(
                      factory.createIdentifier("params"),
                      factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                    ),
                  ],
                ),
              ),
            ],
            ts.NodeFlags.Const,
          ),
        ),
        // const processedParams = assertGuard(searchParams)
        factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                factory.createIdentifier("processedParams"),
                undefined,
                undefined,
                factory.createCallExpression(
                  factory.createIdentifier("assertGuard"),
                  undefined,
                  [factory.createIdentifier("searchParams")],
                ),
              ),
            ],
            ts.NodeFlags.Const,
          ),
        ),
        factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                factory.createIdentifier("originalHandler"),
                undefined,
                factory.createFunctionTypeNode(
                  undefined,
                  [
                    factory.createParameterDeclaration(
                      undefined,
                      undefined,
                      "params",
                      undefined,
                      typeNode,
                    ),
                    factory.createParameterDeclaration(
                      undefined,
                      undefined,
                      "utils",
                      undefined,
                      factory.createImportTypeNode(
                        factory.createLiteralTypeNode(
                          factory.createStringLiteral("@514labs/moose-lib"),
                        ),
                        undefined,
                        factory.createIdentifier("ApiUtil"),
                        [],
                        false,
                      ),
                    ),
                  ],
                  factory.createKeywordTypeNode(SyntaxKind.AnyKeyword),
                ),
                factory.createParenthesizedExpression(handlerFunc),
              ),
            ],
            ts.NodeFlags.Const,
          ),
        ),
        // return originalHandler(processedParams, utils)
        factory.createReturnStatement(
          factory.createCallExpression(
            factory.createIdentifier("originalHandler"),
            undefined,
            [
              factory.createIdentifier("processedParams"),
              factory.createIdentifier("utils"),
            ],
          ),
        ),
      ],
      true,
    ),
  );

  // Generate schemas directly
  const inputSchemaArg =
    node.arguments.length > 3 ?
      node.arguments[3]
    : generateJsonSchemas(typiaCtx, inputType);
  const responseSchemaArg = generateJsonSchemas(typiaCtx, responseType);

  // Create the columns argument if it doesn't exist
  const inputColumnsArg = toColumns(inputType, checker);

  // Create the config argument if it doesn't exist
  const configArg =
    node.arguments.length > 2 ?
      node.arguments[2]
    : factory.createObjectLiteralExpression([], false);

  // Update the Api constructor call with all necessary arguments
  return factory.updateNewExpression(
    node,
    node.expression,
    node.typeArguments,
    [
      node.arguments[0], // name
      wrappedHandler, // wrapped handler
      configArg, // config object
      inputSchemaArg, // input schema
      parseAsAny(JSON.stringify(inputColumnsArg)), // input columns
      responseSchemaArg, // response schema
    ],
  );
};
