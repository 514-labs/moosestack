import ts, { factory } from "typescript";
import {
  avoidTypiaNameClash,
  isMooseFile,
  typiaJsonSchemas,
  sanitizeTypeParameter,
} from "../compilerPluginHelper";
import { toColumns } from "../dataModels/typeConvert";
import { parseAsAny } from "../dmv2/dataModelMetadata";

const iife = (statements: ts.Statement[]): ts.CallExpression =>
  factory.createCallExpression(
    factory.createParenthesizedExpression(
      factory.createArrowFunction(
        undefined,
        undefined,
        [],
        undefined,
        factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
        factory.createBlock(statements, true),
      ),
    ),
    undefined,
    [],
  );

export const isCreateApi = (
  node: ts.Node,
  checker: ts.TypeChecker,
): node is ts.CallExpression => {
  if (!ts.isCallExpression(node)) {
    return false;
  }

  const declaration: ts.Declaration | undefined =
    checker.getResolvedSignature(node)?.declaration;
  if (!declaration || !isMooseFile(declaration.getSourceFile())) {
    return false;
  }

  const { name } = checker.getTypeAtLocation(declaration).symbol;

  return name == "createApi";
};

export const isCreateApiV2 = (
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

const getParamType = (
  funcType: ts.Type,
  checker: ts.TypeChecker,
): ts.TypeNode | undefined => {
  const sig = funcType.getCallSignatures()[0];
  const firstParam = sig && sig.getParameters()[0];
  const t = firstParam && checker.getTypeOfSymbol(firstParam);
  return t && checker.typeToTypeNode(t, undefined, undefined);
};

const typeToOutputSchema = (t: ts.Type, checker: ts.TypeChecker): ts.Type => {
  if (
    t.isIntersection() &&
    t.types.some((inner) => inner.getSymbol()?.name === "ResultSet")
  ) {
    const queryResultSymbol = t.getProperty("__query_result_t");
    if (queryResultSymbol) {
      return checker.getNonNullableType(
        checker.getTypeOfSymbol(queryResultSymbol),
      );
    } else {
      return checker.getAnyType();
    }
  } else if (
    t.getProperty("status") !== undefined &&
    t.getProperty("body") !== undefined
  ) {
    return checker.getTypeOfSymbol(t.getProperty("body")!);
  } else {
    return t;
  }
};

export const transformCreateApi = (
  node: ts.Node,
  checker: ts.TypeChecker,
): ts.Node => {
  if (isCreateApi(node, checker)) {
    return transformLegacyApi(node, checker);
  } else if (isCreateApiV2(node, checker)) {
    return transformNewApi(node as ts.NewExpression, checker);
  }

  return node;
};

export const transformLegacyApi = (
  node: ts.Node,
  checker: ts.TypeChecker,
): ts.Node => {
  if (!isCreateApi(node, checker)) {
    return node;
  }

  const handlerFunc = node.arguments[0];
  const paramType =
    (node.typeArguments && node.typeArguments[0]) ||
    getParamType(checker.getTypeAtLocation(handlerFunc), checker);

  if (paramType === undefined) {
    throw new Error("Unknown type for params");
  }

  const handlerType = checker.getTypeAtLocation(handlerFunc);
  const returnType = handlerType.getCallSignatures()[0]?.getReturnType();
  const awaitedType = checker.getAwaitedType(returnType) || returnType;

  const queryResultType =
    awaitedType.isUnion() ?
      factory.createUnionTypeNode(
        awaitedType.types.flatMap((t) => {
          const typeNode = checker.typeToTypeNode(
            typeToOutputSchema(t, checker),
            undefined,
            undefined,
          );
          return typeNode === undefined ? [] : [typeNode];
        }),
      )
    : checker.typeToTypeNode(
        typeToOutputSchema(awaitedType, checker),
        undefined,
        undefined,
      );

  const wrappedFunc = factory.createArrowFunction(
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
                  [
                    factory.createNewExpression(
                      factory.createIdentifier("URLSearchParams"),
                      undefined,
                      [factory.createIdentifier("params")],
                    ),
                  ],
                ),
              ),
            ],
            ts.NodeFlags.Const,
          ),
        ),
        factory.createReturnStatement(
          factory.createCallExpression(
            factory.createIdentifier("handlerFunc"),
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

  return iife([
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
              [sanitizeTypeParameter(paramType)],
              [],
            ),
          ),
        ],
        ts.NodeFlags.Const,
      ),
    ),
    // the user provided function
    // the Parameters of createApi is a trick to avoid extra imports
    // const handlerFunc: Parameters<typeof createApi<DailyActiveUsersParams>>[0] = async(...) => ...
    factory.createVariableStatement(
      undefined,
      factory.createVariableDeclarationList(
        [
          factory.createVariableDeclaration(
            factory.createIdentifier("handlerFunc"),
            undefined,
            factory.createIndexedAccessTypeNode(
              factory.createTypeReferenceNode(
                factory.createIdentifier("Parameters"),
                [
                  factory.createTypeQueryNode(
                    factory.createIdentifier("createApi"),
                    [paramType],
                  ),
                ],
              ),
              factory.createLiteralTypeNode(factory.createNumericLiteral("0")),
            ),
            handlerFunc,
          ),
        ],
        ts.NodeFlags.Const,
      ),
    ),
    // const wrappedFunc = (params, utils) => {
    //   const processedParams = assertGuard(new URLSearchParams(params))
    //   return handlerFunc(params, utils)
    // }
    factory.createVariableStatement(
      undefined,
      factory.createVariableDeclarationList(
        [
          factory.createVariableDeclaration(
            factory.createIdentifier("wrappedFunc"),
            undefined,
            undefined,
            wrappedFunc,
          ),
        ],
        ts.NodeFlags.Const,
      ),
    ),
    // wrappedFunc["moose_input_schema"] = ____moose____typia.json.schemas<[T]>()
    factory.createExpressionStatement(
      factory.createBinaryExpression(
        factory.createElementAccessExpression(
          factory.createIdentifier("wrappedFunc"),
          factory.createStringLiteral("moose_input_schema"),
        ),
        factory.createToken(ts.SyntaxKind.EqualsToken),
        typiaJsonSchemas(paramType),
      ),
    ),

    // wrappedFunc["moose_output_schema"] = ____moose____typia.json.schemas<[Output]>()
    factory.createExpressionStatement(
      factory.createBinaryExpression(
        factory.createElementAccessExpression(
          factory.createIdentifier("wrappedFunc"),
          factory.createStringLiteral("moose_output_schema"),
        ),
        factory.createToken(ts.SyntaxKind.EqualsToken),
        factory.createCallExpression(
          factory.createPropertyAccessExpression(
            factory.createPropertyAccessExpression(
              factory.createIdentifier(avoidTypiaNameClash),
              factory.createIdentifier("json"),
            ),
            factory.createIdentifier("schemas"),
          ),
          [
            factory.createTupleTypeNode([
              sanitizeTypeParameter(
                queryResultType ||
                  factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
              ),
            ]),
          ],
          [],
        ),
      ),
    ),

    factory.createReturnStatement(factory.createIdentifier("wrappedFunc")),
  ]);
};

// TODO: When the legacy api is removed, follow the args
// pattern in transformNewMooseResource
const transformNewApi = (
  node: ts.NewExpression,
  checker: ts.TypeChecker,
): ts.Node => {
  if (!isCreateApiV2(node, checker)) {
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
        // return originalHandler(processedParams, utils)
        factory.createReturnStatement(
          factory.createCallExpression(
            factory.createParenthesizedExpression(handlerFunc),
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
