import ts, { factory } from "typescript";
import {
  avoidTypiaNameClash,
  isMooseFile,
  typiaJsonSchemas,
} from "../compilerPluginHelper";
import { toColumns } from "../dataModels/typeConvert";
import { IJsonSchemaCollection } from "typia/src/schemas/json/IJsonSchemaCollection";
import { dlqSchema } from "./internal";

const typesToArgsLength = new Map([
  ["OlapTable", 2],
  ["Stream", 2],
  ["DeadLetterQueue", 2],
  ["IngestPipeline", 2],
  ["IngestApi", 2],
  ["Api", 2],
  ["MaterializedView", 1],
  ["Task", 2],
]);

export const isNewMooseResourceWithTypeParam = (
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
  const typeName = sym?.name ?? "";
  if (!typesToArgsLength.has(typeName)) {
    return false;
  }

  return (
    // name only
    (node.arguments?.length === 1 ||
      // config param
      node.arguments?.length === 2) &&
    node.typeArguments?.length === 1
  );
};

export const parseAsAny = (s: string) =>
  factory.createAsExpression(
    factory.createCallExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier("JSON"),
        factory.createIdentifier("parse"),
      ),
      undefined,
      [factory.createStringLiteral(s)],
    ),
    factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
  );

const typiaTypeGuard = (node: ts.NewExpression) => {
  const typeNode = node.typeArguments![0];
  return factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier(avoidTypiaNameClash),
      factory.createIdentifier("createAssert"),
    ),
    [typeNode],
    [],
  );
};

export const transformNewMooseResource = (
  node: ts.NewExpression,
  checker: ts.TypeChecker,
): ts.Node => {
  const typeName = checker.getSymbolAtLocation(node.expression)!.name;

  const typeNode = node.typeArguments![0];

  const internalArguments =
    typeName === "DeadLetterQueue" ?
      [typiaTypeGuard(node)]
    : [
        typiaJsonSchemas(typeNode),
        parseAsAny(
          JSON.stringify(
            toColumns(checker.getTypeAtLocation(typeNode), checker),
          ),
        ),
      ];
  const resourceName = checker.getSymbolAtLocation(node.expression)!.name;

  const argLength = typesToArgsLength.get(resourceName)!;
  const needsExtraArg = node.arguments!.length === argLength - 1; // provide empty config if undefined

  let updatedArgs = [
    ...node.arguments!,
    ...(needsExtraArg ?
      [factory.createObjectLiteralExpression([], false)]
    : []),
    ...internalArguments,
  ];

  // For OlapTable and IngestPipeline, also inject typia validation functions
  if (resourceName === "OlapTable" || resourceName === "IngestPipeline") {
    // Create a single TypiaValidators object with all three validation functions
    const validatorsObject = factory.createObjectLiteralExpression(
      [
        factory.createPropertyAssignment(
          factory.createIdentifier("validate"),
          createTypiaValidator(typeNode),
        ),
        factory.createPropertyAssignment(
          factory.createIdentifier("assert"),
          createTypiaAssert(typeNode),
        ),
        factory.createPropertyAssignment(
          factory.createIdentifier("is"),
          createTypiaIs(typeNode),
        ),
      ],
      true,
    );

    updatedArgs = [...updatedArgs, validatorsObject];
  }

  return ts.factory.updateNewExpression(
    node,
    node.expression,
    node.typeArguments,
    updatedArgs,
  );
};

/**
 * Creates a typia validator function call for the given type
 * e.g., ____moose____typia.createValidate<T>()
 */
export const createTypiaValidator = (typeNode: ts.TypeNode) => {
  // Create the typia validator call
  const typiaValidator = factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier(avoidTypiaNameClash),
      factory.createIdentifier("createValidate"),
    ),
    [typeNode],
    [],
  );

  // Wrap it to transform the result to match our expected interface
  // (data: unknown) => {
  //   const result = typiaValidator(data);
  //   return {
  //     success: result.success,
  //     data: result.success ? result.data : undefined,
  //     errors: result.success ? undefined : result.errors
  //   };
  // }
  return factory.createArrowFunction(
    undefined,
    undefined,
    [
      factory.createParameterDeclaration(
        undefined,
        undefined,
        factory.createIdentifier("data"),
        undefined,
        factory.createKeywordTypeNode(ts.SyntaxKind.UnknownKeyword),
        undefined,
      ),
    ],
    undefined,
    factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken),
    factory.createBlock(
      [
        // const result = typiaValidator(data);
        factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                factory.createIdentifier("result"),
                undefined,
                undefined,
                factory.createCallExpression(typiaValidator, undefined, [
                  factory.createIdentifier("data"),
                ]),
              ),
            ],
            ts.NodeFlags.Const,
          ),
        ),
        // return { success: result.success, data: result.success ? result.data : undefined, errors: result.success ? undefined : result.errors };
        factory.createReturnStatement(
          factory.createObjectLiteralExpression(
            [
              factory.createPropertyAssignment(
                factory.createIdentifier("success"),
                factory.createPropertyAccessExpression(
                  factory.createIdentifier("result"),
                  factory.createIdentifier("success"),
                ),
              ),
              factory.createPropertyAssignment(
                factory.createIdentifier("data"),
                factory.createConditionalExpression(
                  factory.createPropertyAccessExpression(
                    factory.createIdentifier("result"),
                    factory.createIdentifier("success"),
                  ),
                  factory.createToken(ts.SyntaxKind.QuestionToken),
                  factory.createPropertyAccessExpression(
                    factory.createIdentifier("result"),
                    factory.createIdentifier("data"),
                  ),
                  factory.createToken(ts.SyntaxKind.ColonToken),
                  factory.createIdentifier("undefined"),
                ),
              ),
              factory.createPropertyAssignment(
                factory.createIdentifier("errors"),
                factory.createConditionalExpression(
                  factory.createPropertyAccessExpression(
                    factory.createIdentifier("result"),
                    factory.createIdentifier("success"),
                  ),
                  factory.createToken(ts.SyntaxKind.QuestionToken),
                  factory.createIdentifier("undefined"),
                  factory.createToken(ts.SyntaxKind.ColonToken),
                  factory.createPropertyAccessExpression(
                    factory.createIdentifier("result"),
                    factory.createIdentifier("errors"),
                  ),
                ),
              ),
            ],
            true,
          ),
        ),
      ],
      true,
    ),
  );
};

/**
 * Creates a typia assert function call for the given type
 * e.g., ____moose____typia.createAssert<T>()
 */
export const createTypiaAssert = (typeNode: ts.TypeNode) =>
  factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier(avoidTypiaNameClash),
      factory.createIdentifier("createAssert"),
    ),
    [typeNode],
    [],
  );

/**
 * Creates a typia is function call for the given type
 * e.g., ____moose____typia.createIs<T>()
 */
export const createTypiaIs = (typeNode: ts.TypeNode) =>
  factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createIdentifier(avoidTypiaNameClash),
      factory.createIdentifier("createIs"),
    ),
    [typeNode],
    [],
  );

// Detect static factory calls like OlapTable.withS3Queue<T>(...)
export const isOlapTableFactoryCallWithTypeParam = (
  node: ts.Node,
  checker: ts.TypeChecker,
): node is ts.CallExpression => {
  if (!ts.isCallExpression(node)) return false;
  if (!node.typeArguments || node.typeArguments.length !== 1) return false;

  const declaration: ts.Declaration | undefined =
    checker.getResolvedSignature(node)?.declaration;
  if (!declaration || !isMooseFile(declaration.getSourceFile())) return false;

  if (!ts.isPropertyAccessExpression(node.expression)) return false;
  const callee = node.expression;
  const lhsSym = checker.getSymbolAtLocation(callee.expression);
  const rhsName = callee.name.getText();

  if (!lhsSym || lhsSym.name !== "OlapTable") return false;

  const supported = new Set([
    "withS3Queue",
    "withReplacingMergeTree",
    "withMergeTree",
  ]);
  return supported.has(rhsName);
};

// Transform OlapTable.withX<T>(...) into new OlapTable<T>(name, config, schema, columns, validators)
export const transformOlapTableFactoryCall = (
  node: ts.CallExpression,
  checker: ts.TypeChecker,
): ts.Node => {
  if (!ts.isPropertyAccessExpression(node.expression)) return node;
  const methodName = node.expression.name.getText();
  const typeNode = node.typeArguments![0];

  // Common internal args: schema, columns, validators
  const schemaArg = typiaJsonSchemas(typeNode);
  const columnsArg = parseAsAny(
    JSON.stringify(toColumns(checker.getTypeAtLocation(typeNode), checker)),
  );

  const validatorsObject = factory.createObjectLiteralExpression(
    [
      factory.createPropertyAssignment(
        factory.createIdentifier("validate"),
        createTypiaValidator(typeNode),
      ),
      factory.createPropertyAssignment(
        factory.createIdentifier("assert"),
        createTypiaAssert(typeNode),
      ),
      factory.createPropertyAssignment(
        factory.createIdentifier("is"),
        createTypiaIs(typeNode),
      ),
    ],
    true,
  );

  const nameArg = node.arguments[0];

  const createNewExpression = (
    configObject: ts.Expression,
  ): ts.NewExpression =>
    factory.createNewExpression(
      factory.createIdentifier("OlapTable"),
      [typeNode],
      [nameArg, configObject, schemaArg, columnsArg, validatorsObject],
    );

  const asAny = (expr: ts.Expression) =>
    factory.createAsExpression(
      expr,
      factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
    );

  if (methodName === "withS3Queue") {
    const s3PathArg = node.arguments[1];
    const formatArg = node.arguments[2];
    const optionsArg = node.arguments[3];

    const props: ts.ObjectLiteralElementLike[] = [
      // engine as string literal to avoid new imports; cast config as any below
      factory.createPropertyAssignment(
        factory.createIdentifier("engine"),
        factory.createStringLiteral("S3Queue"),
      ),
      factory.createPropertyAssignment(
        factory.createIdentifier("s3Path"),
        s3PathArg,
      ),
      factory.createPropertyAssignment(
        factory.createIdentifier("format"),
        formatArg,
      ),
    ];

    if (optionsArg) {
      // Spread user options (including optional 'settings') to allow overrides
      props.splice(3, 0, factory.createSpreadAssignment(optionsArg));
    } else {
      // No options provided: set default S3Queue settings
      const defaultSettings = factory.createObjectLiteralExpression(
        [
          factory.createPropertyAssignment(
            factory.createIdentifier("mode"),
            factory.createStringLiteral("unordered"),
          ),
        ],
        true,
      );
      props.push(
        factory.createPropertyAssignment(
          factory.createIdentifier("settings"),
          defaultSettings,
        ),
      );
    }

    const configObject = factory.createObjectLiteralExpression(props, true);
    return createNewExpression(asAny(configObject));
  }

  if (methodName === "withReplacingMergeTree") {
    const orderByArg = node.arguments[1];
    const optionsArg = node.arguments[2];

    const props: ts.ObjectLiteralElementLike[] = [
      factory.createPropertyAssignment(
        factory.createIdentifier("engine"),
        factory.createStringLiteral("ReplacingMergeTree"),
      ),
      factory.createPropertyAssignment(
        factory.createIdentifier("orderByFields"),
        orderByArg,
      ),
    ];
    if (optionsArg) props.push(factory.createSpreadAssignment(optionsArg));

    const configObject = factory.createObjectLiteralExpression(props, true);
    return createNewExpression(asAny(configObject));
  }

  if (methodName === "withMergeTree") {
    const orderByArg = node.arguments[1];
    const optionsArg = node.arguments[2];

    const props: ts.ObjectLiteralElementLike[] = [
      factory.createPropertyAssignment(
        factory.createIdentifier("engine"),
        factory.createStringLiteral("MergeTree"),
      ),
    ];
    if (orderByArg) {
      props.push(
        factory.createPropertyAssignment(
          factory.createIdentifier("orderByFields"),
          orderByArg,
        ),
      );
    }
    if (optionsArg) props.push(factory.createSpreadAssignment(optionsArg));

    const configObject = factory.createObjectLiteralExpression(props, true);
    return createNewExpression(asAny(configObject));
  }

  return node;
};
