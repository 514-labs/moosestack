import ts, { displayPartsToString, factory } from "typescript";
import { isMooseFile, type TransformContext } from "../compilerPluginHelper";
import { toColumns } from "../dataModels/typeConvert";
import {
  generateValidateFunction,
  generateIsFunction,
  generateAssertFunction,
  generateJsonSchemas,
} from "../typiaDirectIntegration";

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

  // Require arguments to be present
  if (!node.arguments) {
    return false;
  }

  const expectedArgLength = typesToArgsLength.get(typeName)!;
  const actualArgLength = node.arguments.length;

  // Check if this is an untransformed moose resource
  // Transformed resources have more arguments (schema, columns, validators, etc.)
  const isUntransformed =
    actualArgLength === expectedArgLength - 1 || // name only
    actualArgLength === expectedArgLength; // name + config

  return isUntransformed && node.typeArguments?.length === 1;
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

export const transformNewMooseResource = (
  node: ts.NewExpression,
  checker: ts.TypeChecker,
  ctx: TransformContext,
): ts.Node => {
  const typeName = checker.getSymbolAtLocation(node.expression)!.name;

  const typeNode = node.typeArguments![0];

  // For IngestPipeline, check if table is configured in the config object
  // Index signatures are only allowed when table is false/not configured
  // (because OlapTable requires a fixed schema)
  let ingestPipelineHasTable = true; // Default to true (safe: disallows index signatures)
  if (
    typeName === "IngestPipeline" &&
    node.arguments &&
    node.arguments.length >= 2
  ) {
    const configArg = node.arguments[1];
    if (ts.isObjectLiteralExpression(configArg)) {
      const tableProperty = configArg.properties.find(
        (prop): prop is ts.PropertyAssignment =>
          ts.isPropertyAssignment(prop) &&
          ts.isIdentifier(prop.name) &&
          prop.name.text === "table",
      );
      if (tableProperty) {
        const tableValue = tableProperty.initializer;
        // Check if table value is explicitly false
        ingestPipelineHasTable = tableValue.kind !== ts.SyntaxKind.FalseKeyword;
      }
      // If table property is not found, keep default (true = has table)
      // This is the safe default since 'table' is a required property
    }
  }

  // Allow index signatures for IngestApi, Stream, and IngestPipeline (when table is not configured)
  // These resources accept arbitrary payload fields that pass through to streaming functions
  const allowIndexSignatures =
    ["IngestApi", "Stream"].includes(typeName) ||
    (typeName === "IngestPipeline" && !ingestPipelineHasTable);

  // Check if the type actually has an index signature
  const typeAtLocation = checker.getTypeAtLocation(typeNode);
  const indexSignatures = checker.getIndexInfosOfType(typeAtLocation);
  const hasIndexSignature = allowIndexSignatures && indexSignatures.length > 0;

  // Validate: IngestPipeline with table=true cannot have index signatures
  // because extra fields would be silently dropped when writing to ClickHouse
  if (
    typeName === "IngestPipeline" &&
    ingestPipelineHasTable &&
    indexSignatures.length > 0
  ) {
    throw new Error(
      `IngestPipeline cannot use a type with index signatures when 'table' is configured. ` +
        `Extra fields would be silently dropped when writing to the ClickHouse table. ` +
        `Either:\n` +
        `  1. Remove the index signature from your type to use a fixed schema, or\n` +
        `  2. Set 'table: false' in your IngestPipeline config if you only need the API and stream`,
    );
  }

  // Get the typia context for direct code generation
  const typiaCtx = ctx.typiaContext;

  let internalArguments: ts.Expression[];

  if (typeName === "DeadLetterQueue") {
    // DeadLetterQueue uses type guard (assert)
    internalArguments = [generateAssertFunction(typiaCtx, typeAtLocation)];
  } else {
    // Other resources use JSON schemas + columns
    internalArguments = [
      generateJsonSchemas(typiaCtx, typeAtLocation),
      parseAsAny(
        JSON.stringify(
          toColumns(typeAtLocation, checker, {
            allowIndexSignatures,
          }),
        ),
      ),
    ];
  }

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

  // Extract TSDoc comment from the type parameter interface for table-level COMMENT
  const typeSymbol = typeAtLocation.getSymbol();
  const typeDocComment = typeSymbol?.getDocumentationComment(checker) ?? [];
  const tableComment =
    typeDocComment.length > 0 ? displayPartsToString(typeDocComment) : null;

  // For OlapTable and IngestPipeline, also inject typia validation functions
  if (resourceName === "OlapTable" || resourceName === "IngestPipeline") {
    // Create a single TypiaValidators object with all three validation functions
    // using direct typia code generation (uses shared typiaCtx for imports)
    const validatorsObject = factory.createObjectLiteralExpression(
      [
        factory.createPropertyAssignment(
          factory.createIdentifier("validate"),
          wrapValidateFunction(
            generateValidateFunction(typiaCtx, typeAtLocation),
          ),
        ),
        factory.createPropertyAssignment(
          factory.createIdentifier("assert"),
          generateAssertFunction(typiaCtx, typeAtLocation),
        ),
        factory.createPropertyAssignment(
          factory.createIdentifier("is"),
          generateIsFunction(typiaCtx, typeAtLocation),
        ),
      ],
      true,
    );

    updatedArgs = [...updatedArgs, validatorsObject];

    // For OlapTable, inject the table comment from TSDoc on the interface
    if (resourceName === "OlapTable") {
      updatedArgs = [
        ...updatedArgs,
        tableComment !== null ?
          factory.createStringLiteral(tableComment)
        : factory.createNull(),
      ];
    }

    // For IngestPipeline, also pass allowExtraFields so it can propagate to internal Stream/IngestApi
    if (resourceName === "IngestPipeline") {
      updatedArgs = [
        ...updatedArgs,
        hasIndexSignature ? factory.createTrue() : factory.createFalse(),
      ];
    }
  }

  // For IngestApi and Stream, add the allowExtraFields flag after undefined validators
  // This enables passing extra fields through to streaming functions when the type has an index signature
  if (resourceName === "IngestApi" || resourceName === "Stream") {
    updatedArgs = [
      ...updatedArgs,
      factory.createIdentifier("undefined"), // validators (not used for these types)
      hasIndexSignature ? factory.createTrue() : factory.createFalse(),
    ];
  }

  return ts.factory.updateNewExpression(
    node,
    node.expression,
    node.typeArguments,
    updatedArgs,
  );
};

/**
 * Wraps a typia validate function to match our expected interface
 * Transforms typia's IValidation result to our { success, data, errors } format
 */
const wrapValidateFunction = (validateFn: ts.Expression): ts.Expression => {
  // (data: unknown) => {
  //   const result = validateFn(data);
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
        factory.createVariableStatement(
          undefined,
          factory.createVariableDeclarationList(
            [
              factory.createVariableDeclaration(
                factory.createIdentifier("result"),
                undefined,
                undefined,
                factory.createCallExpression(validateFn, undefined, [
                  factory.createIdentifier("data"),
                ]),
              ),
            ],
            ts.NodeFlags.Const,
          ),
        ),
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
