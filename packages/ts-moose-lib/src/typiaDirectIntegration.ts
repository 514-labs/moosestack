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
import { HttpAssertQueryProgrammer } from "typia/lib/programmers/http/HttpAssertQueryProgrammer";
import { MetadataCollection } from "typia/lib/factories/MetadataCollection";
import { MetadataFactory } from "typia/lib/factories/MetadataFactory";
import { LiteralFactory } from "typia/lib/factories/LiteralFactory";
import { ITypiaContext } from "typia/lib/transformers/ITypiaContext";
import { IJsonSchemaCollection } from "typia/lib/schemas/json/IJsonSchemaCollection";
import { avoidTypiaNameClash } from "./compilerPluginHelper";

// Simple type for JSON Schema objects - we use a minimal type instead of
// importing @samchon/openapi to avoid adding an extra dependency.
// Based on OpenApi.IJsonSchema which includes:
// IConstant, IBoolean, IInteger, INumber, IString, IArray, ITuple,
// IObject, IReference, IOneOf, INull, IUnknown
type JsonSchema = {
  type?: string;
  format?: string;
  $ref?: string;
  // IObject
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
  required?: string[];
  // IArray
  items?: JsonSchema;
  // ITuple
  prefixItems?: JsonSchema[];
  additionalItems?: boolean | JsonSchema;
  // Union types
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  [key: string]: unknown;
};

/**
 * Context for direct typia code generation
 */
export interface TypiaDirectContext {
  program: ts.Program;
  checker: ts.TypeChecker;
  transformer: ts.TransformationContext;
  importer: ImportProgrammer;
  modulo: ts.LeftHandSideExpression;
  sourceFile: ts.SourceFile;
}

/**
 * Creates a synthetic identifier with a patched getText method.
 * Typia's programmers call modulo.getText() which normally requires
 * the node to be attached to a source file. We patch the method directly.
 */
const createSyntheticModulo = (): ts.LeftHandSideExpression => {
  const identifier = ts.factory.createIdentifier("typia");

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
  sourceFile: ts.SourceFile,
): TypiaDirectContext => {
  const importer = new ImportProgrammer({
    internalPrefix: avoidTypiaNameClash,
  });

  return {
    program,
    checker: program.getTypeChecker(),
    transformer,
    importer,
    modulo: createSyntheticModulo(),
    sourceFile,
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
    // Not used by the programmers we call directly (CheckerProgrammer,
    // HttpAssertQueryProgrammer, JsonSchemasProgrammer) - only used by
    // FileTransformer which we bypass
    addDiagnostic: () => 0,
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
 * Generates an HTTP assert query function for validating URL query parameters
 * This is used by the Api class to validate incoming query parameters
 */
export const generateHttpAssertQueryFunction = (
  ctx: TypiaDirectContext,
  type: ts.Type,
  typeName?: string,
): ts.Expression => {
  const typiaCtx = toTypiaContext(ctx);

  return HttpAssertQueryProgrammer.write({
    context: typiaCtx,
    modulo: ctx.modulo,
    type,
    name: typeName,
  });
};

// ============================================================================
// JSON Schema Post-Processing
// ============================================================================

/**
 * The standard JSON Schema representation for Date types.
 * Typia outputs Date as an empty object schema with a $ref, but the correct
 * representation is { type: "string", format: "date-time" }.
 */
const DATE_SCHEMA: JsonSchema = {
  type: "string",
  format: "date-time",
};

/**
 * Checks if a property name is an internal ClickHouse tag that should be
 * stripped from the JSON schema.
 */
const isClickHouseInternalProperty = (name: string): boolean =>
  name.startsWith("_clickhouse_") || name === "_LowCardinality";

/**
 * Recursively processes a JSON schema to:
 * 1. Replace $ref to Date with inline { type: "string", format: "date-time" }
 * 2. Remove internal ClickHouse properties from object schemas
 *
 * Handles all OpenApi.IJsonSchema variants:
 * IConstant, IBoolean, IInteger, INumber, IString, IArray, ITuple,
 * IObject, IReference, IOneOf, INull, IUnknown
 */
const cleanJsonSchema = (schema: JsonSchema): JsonSchema => {
  // Handle $ref to Date - replace with inline date-time schema
  if (schema.$ref === "#/components/schemas/Date") {
    // Preserve any other properties from the original schema (like description)
    const { $ref, ...rest } = schema;
    return { ...DATE_SCHEMA, ...rest };
  }

  // Handle object schemas (IObject) - filter out ClickHouse internal properties
  if (schema.type === "object") {
    const result: JsonSchema = { ...schema };

    // Clean properties
    if (schema.properties) {
      const cleanedProperties: Record<string, JsonSchema> = {};
      const cleanedRequired: string[] = [];

      for (const [key, value] of Object.entries(schema.properties)) {
        if (!isClickHouseInternalProperty(key)) {
          cleanedProperties[key] = cleanJsonSchema(value);
          if (schema.required?.includes(key)) {
            cleanedRequired.push(key);
          }
        }
      }

      result.properties = cleanedProperties;
      result.required =
        cleanedRequired.length > 0 ? cleanedRequired : undefined;
    }

    // Clean additionalProperties if it's a schema
    if (
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object"
    ) {
      result.additionalProperties = cleanJsonSchema(
        schema.additionalProperties,
      );
    }

    return result;
  }

  // Handle array schemas (IArray)
  if (schema.type === "array") {
    const result: JsonSchema = { ...schema };

    // Clean items (IArray.items)
    if (schema.items) {
      result.items = cleanJsonSchema(schema.items);
    }

    // Clean prefixItems (ITuple.prefixItems)
    if (schema.prefixItems && Array.isArray(schema.prefixItems)) {
      result.prefixItems = schema.prefixItems.map(cleanJsonSchema);
    }

    // Clean additionalItems if it's a schema (ITuple.additionalItems)
    if (schema.additionalItems && typeof schema.additionalItems === "object") {
      result.additionalItems = cleanJsonSchema(schema.additionalItems);
    }

    return result;
  }

  // Handle oneOf/anyOf/allOf (IOneOf and merged types)
  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    return {
      ...schema,
      oneOf: schema.oneOf.map(cleanJsonSchema),
    };
  }
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    return {
      ...schema,
      anyOf: schema.anyOf.map(cleanJsonSchema),
    };
  }
  if (schema.allOf && Array.isArray(schema.allOf)) {
    return {
      ...schema,
      allOf: schema.allOf.map(cleanJsonSchema),
    };
  }

  // Primitive types (IConstant, IBoolean, IInteger, INumber, IString, INull, IUnknown)
  // don't need recursion - return as-is
  return schema;
};

/**
 * Post-processes a JSON schema collection to clean up Moose-specific artifacts:
 * 1. Converts Date schemas to { type: "string", format: "date-time" }
 * 2. Removes internal ClickHouse properties (_clickhouse_*, _LowCardinality)
 */
const cleanJsonSchemaCollection = <V extends "3.0" | "3.1">(
  collection: IJsonSchemaCollection<V>,
): IJsonSchemaCollection<V> => {
  // Clean component schemas
  const cleanedComponentsSchemas: Record<string, JsonSchema> = {};

  if (collection.components.schemas) {
    for (const [name, schema] of Object.entries(
      collection.components.schemas,
    )) {
      // Replace Date schema with proper date-time representation
      if (name === "Date") {
        cleanedComponentsSchemas[name] = DATE_SCHEMA;
      } else {
        cleanedComponentsSchemas[name] = cleanJsonSchema(schema as JsonSchema);
      }
    }
  }

  // Clean top-level schemas
  const cleanedSchemas = collection.schemas.map((s) =>
    cleanJsonSchema(s as JsonSchema),
  );

  return {
    ...collection,
    components: {
      ...collection.components,
      schemas: cleanedComponentsSchemas,
    },
    schemas: cleanedSchemas,
  } as IJsonSchemaCollection<V>;
};

/**
 * Generates JSON schemas directly using typia's JsonSchemasProgrammer.
 *
 * Uses the same options as CheckerProgrammer (absorb: true, escape: false)
 * to handle our custom ClickHouse type tags that typia doesn't recognize.
 *
 * Post-processes the generated schema to:
 * 1. Convert Date to { type: "string", format: "date-time" }
 * 2. Strip internal ClickHouse properties (_clickhouse_*, _LowCardinality)
 */
export const generateJsonSchemas = (
  ctx: TypiaDirectContext,
  type: ts.Type,
): ts.Expression => {
  // Use same options as CheckerProgrammer for consistency
  // Key: escape: false allows intersection handling without errors
  // Note: We don't strip custom type tags here - cleanJsonSchemaCollection
  // handles removing _clickhouse_* properties from the output
  const metadataResult = MetadataFactory.analyze({
    checker: ctx.checker,
    transformer: ctx.transformer,
    options: {
      absorb: true,
      constant: true,
      escape: false, // Match CheckerProgrammer - this is key!
    },
    collection: new MetadataCollection({
      replace: MetadataCollection.replace,
    }),
    type: type,
  });

  if (!metadataResult.success) {
    const errors = metadataResult.errors
      .map((e) => `${e.name}: ${e.messages.join(", ")}`)
      .join("; ");
    throw new Error(`Typia metadata analysis failed: ${errors}`);
  }

  // Generate the JSON schema collection
  const rawCollection = JsonSchemasProgrammer.write({
    version: "3.1",
    metadatas: [metadataResult.data],
  });

  // Post-process to clean up Moose-specific artifacts
  const collection = cleanJsonSchemaCollection(rawCollection);

  // Convert the collection to an AST literal
  return ts.factory.createAsExpression(
    LiteralFactory.write(collection),
    ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
  );
};
