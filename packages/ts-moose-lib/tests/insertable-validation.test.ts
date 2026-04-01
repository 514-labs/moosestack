import { expect } from "chai";
import ts from "typescript";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { transformNewMooseResource } from "../src/dmv2/dataModelMetadata";
import type { TransformContext } from "../src/compilerPluginHelper";
import { createTypiaContext } from "../src/typiaDirectIntegration";

/**
 * Tests that the compiler plugin generates Insertable<T> validators
 * for OlapTable types with computed (ALIAS/MATERIALIZED) columns,
 * and that those validators accept/reject records appropriately.
 */

function transformOlapTable(
  tempDir: string,
  sourceText: string,
): {
  success: boolean;
  error?: string;
  updatedArgs?: number;
  transformed?: ts.NewExpression;
} {
  const srcFile = path.join(tempDir, "model.ts");
  fs.writeFileSync(srcFile, sourceText, "utf8");

  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    baseUrl: path.resolve(__dirname, ".."),
    paths: {
      "@514labs/moose-lib": [
        path.resolve(__dirname, "../src/browserCompatible.ts"),
      ],
    },
  };

  try {
    const program = ts.createProgram({
      rootNames: [
        srcFile,
        path.resolve(__dirname, "../src/browserCompatible.ts"),
      ],
      options: compilerOptions,
    });

    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(srcFile)!;

    let updatedArgs: number | undefined;
    let transformed: ts.NewExpression | undefined;
    let transformError: string | undefined;

    ts.transform(
      [sourceFile],
      [
        (transformationContext) => {
          return (sf) => {
            const typiaContext = createTypiaContext(
              program,
              transformationContext,
              sf,
            );

            const ctx: TransformContext = {
              typeChecker: checker,
              program,
              typiaContext,
            };

            function visit(node: ts.Node): ts.Node {
              if (
                ts.isNewExpression(node) &&
                ts.isIdentifier(node.expression) &&
                node.expression.text === "OlapTable"
              ) {
                try {
                  const result = transformNewMooseResource(
                    node,
                    checker,
                    ctx,
                  ) as ts.NewExpression;
                  updatedArgs = result.arguments?.length;
                  transformed = result;
                  return result;
                } catch (error) {
                  transformError =
                    error instanceof Error ? error.message : String(error);
                }
              }
              return ts.visitEachChild(node, visit, transformationContext);
            }
            return ts.visitEachChild(sf, visit, transformationContext);
          };
        },
      ],
    );

    if (transformError) {
      return { success: false, error: transformError };
    }

    return { success: true, updatedArgs, transformed };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Emit the transformed AST to JS, eval the 6th constructor arg (insertValidators),
 * and return the validators object with {validate, assert, is} functions.
 */
function extractInsertValidators(
  transformed: ts.NewExpression,
): { validate: Function; is: Function; assert: Function } | undefined {
  const args = transformed.arguments;
  if (!args || args.length < 6) return undefined;

  const insertValidatorsNode = args[5];
  const printer = ts.createPrinter();
  const resultFile = ts.createSourceFile(
    "output.ts",
    "",
    ts.ScriptTarget.ES2022,
    false,
    ts.ScriptKind.TS,
  );
  const tsCode = printer.printNode(
    ts.EmitHint.Expression,
    insertValidatorsNode,
    resultFile,
  );

  const { outputText } = ts.transpileModule(`const __v = ${tsCode}`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  });

  const fn = new Function(`${outputText}; return __v;`);
  return fn();
}

describe("Insertable<T> validation generation", function () {
  this.timeout(30000);

  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moose-insertable-test-"));
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should generate 6 args for OlapTable with ALIAS column", function () {
    const source = `
      import { OlapTable, Key, DateTime, ClickHouseAlias } from "@514labs/moose-lib";

      interface UserEvents {
        id: Key<string>;
        timestamp: DateTime;
        userId: string;
        eventDate: Date & ClickHouseAlias<"toDate(timestamp)">;
      }

      export const table = new OlapTable<UserEvents>("UserEvents", {
        orderByFields: ["id"],
      });
    `;

    const result = transformOlapTable(tempDir, source);
    expect(result.success).to.be.true;
    expect(result.updatedArgs).to.equal(6);
  });

  it("should generate 6 args for OlapTable with MATERIALIZED column", function () {
    const source = `
      import { OlapTable, Key, DateTime, ClickHouseMaterialized } from "@514labs/moose-lib";

      interface UserEvents {
        id: Key<string>;
        timestamp: DateTime;
        userId: string;
        eventDate: Date & ClickHouseMaterialized<"toDate(timestamp)">;
      }

      export const table = new OlapTable<UserEvents>("UserEvents", {
        orderByFields: ["id"],
      });
    `;

    const result = transformOlapTable(tempDir, source);
    expect(result.success).to.be.true;
    expect(result.updatedArgs).to.equal(6);
  });

  it("should generate 6 args even for OlapTable without computed columns", function () {
    const source = `
      import { OlapTable, Key, DateTime } from "@514labs/moose-lib";

      interface UserEvents {
        id: Key<string>;
        timestamp: DateTime;
        userId: string;
      }

      export const table = new OlapTable<UserEvents>("UserEvents", {
        orderByFields: ["id"],
      });
    `;

    const result = transformOlapTable(tempDir, source);
    expect(result.success).to.be.true;
    expect(result.updatedArgs).to.equal(6);
  });

  it("insert validators should accept records omitting ALIAS fields", function () {
    const source = `
      import { OlapTable, Key, DateTime, ClickHouseAlias } from "@514labs/moose-lib";

      interface UserEvents {
        id: Key<string>;
        timestamp: DateTime;
        userId: string;
        eventDate: Date & ClickHouseAlias<"toDate(timestamp)">;
      }

      export const table = new OlapTable<UserEvents>("UserEvents", {
        orderByFields: ["id"],
      });
    `;

    const result = transformOlapTable(tempDir, source);
    expect(result.success).to.be.true;

    const validators = extractInsertValidators(result.transformed!);
    expect(validators).to.exist;

    const validRecord = {
      id: "abc",
      timestamp: new Date("2024-01-01T00:00:00Z"),
      userId: "user-1",
    };

    expect(validators!.is(validRecord)).to.be.true;
  });

  it("insert validators should reject records missing required non-computed fields", function () {
    const source = `
      import { OlapTable, Key, DateTime, ClickHouseAlias } from "@514labs/moose-lib";

      interface UserEvents {
        id: Key<string>;
        timestamp: DateTime;
        userId: string;
        eventDate: Date & ClickHouseAlias<"toDate(timestamp)">;
      }

      export const table = new OlapTable<UserEvents>("UserEvents", {
        orderByFields: ["id"],
      });
    `;

    const result = transformOlapTable(tempDir, source);
    expect(result.success).to.be.true;

    const validators = extractInsertValidators(result.transformed!);
    expect(validators).to.exist;

    const invalidRecord = {
      id: "abc",
      timestamp: new Date("2024-01-01T00:00:00Z"),
      // userId is missing — should be invalid
    };

    expect(validators!.is(invalidRecord)).to.be.false;
  });
});
