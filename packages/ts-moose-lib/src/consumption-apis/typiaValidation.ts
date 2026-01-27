import ts, { factory, SyntaxKind } from "typescript";
import {
  avoidTypiaNameClash,
  isMooseFile,
  typiaJsonSchemas,
} from "../compilerPluginHelper";
import { toColumns } from "../dataModels/typeConvert";
import { parseAsAny } from "../dmv2/dataModelMetadata";

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
): ts.Node => {
  if (!isApiV2(node, checker)) {
    return node;
  }

  if (!node.arguments || node.arguments.length < 2 || !node.typeArguments) {
    return node;
  }

  // Get both type parameters from Api<T, R>
  const typeNode = node.typeArguments[0];
  const responseTypeNode =
    node.typeArguments[1] ||
    factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);

  // Get the handler function (second argument)
  const handlerFunc = node.arguments[1];

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
        // const assertGuard = ____moose____typia.http.createAssertQuery<T>()
        factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                factory.createIdentifier("assertGuard"),
                undefined,
                undefined,
                factory.createCallExpression(
                  factory.createPropertyAccessExpression(
                    factory.createPropertyAccessExpression(
                      factory.createIdentifier(avoidTypiaNameClash),
                      factory.createIdentifier("http"),
                    ),
                    factory.createIdentifier("createAssertQuery"),
                  ),
                  [typeNode],
                  [],
                ),
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

  // Create the schema arguments
  const inputSchemaArg =
    node.arguments.length > 3 ? node.arguments[3] : typiaJsonSchemas(typeNode);
  const responseSchemaArg = typiaJsonSchemas(responseTypeNode);

  // Create the columns argument if it doesn't exist
  const inputColumnsArg = toColumns(
    checker.getTypeAtLocation(typeNode),
    checker,
  );

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
