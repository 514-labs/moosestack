import { expect } from "chai";
import ts from "typescript";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { transformNewMooseResource } from "../src/dmv2/dataModelMetadata";
import type { TransformContext } from "../src/compilerPluginHelper";
import { createTypiaContext } from "../src/typiaDirectIntegration";

/**
 * Test suite for index signature validation in IngestPipeline
 * Verifies that IngestPipeline with table=true cannot use types with index signatures
 * to prevent silent data loss when writing to ClickHouse
 */

function testIngestPipelineValidation(
  tempDir: string,
  sourceText: string,
): { success: boolean; error?: string } {
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

    // Walk the AST and find IngestPipeline instantiations
    let validationError: string | undefined;

    // Use ts.transform to get a real TransformationContext
    ts.transform(sourceFile, [
      (transformationContext) => {
        const typiaContext = createTypiaContext(program, transformationContext);

        const ctx: TransformContext = {
          typeChecker: checker,
          program,
          transformer: transformationContext,
          typiaContext,
        };

        return (sf) => {
          function visit(node: ts.Node): ts.Node {
            if (
              ts.isNewExpression(node) &&
              ts.isIdentifier(node.expression) &&
              node.expression.text === "IngestPipeline"
            ) {
              try {
                // This will throw if validation fails
                transformNewMooseResource(node, checker, ctx);
              } catch (error) {
                const errorMessage =
                  error instanceof Error ? error.message : String(error);
                // Only capture validation errors (about index signatures)
                if (errorMessage.includes("index signature")) {
                  validationError = errorMessage;
                }
              }
            }
            return ts.visitEachChild(node, visit, transformationContext);
          }
          return ts.visitEachChild(sf, visit, transformationContext);
        };
      },
    ]);

    if (validationError) {
      return { success: false, error: validationError };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

describe("IngestPipeline Index Signature Validation", function () {
  this.timeout(20000); // Increase timeout for TypeScript compilation

  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moose-test-"));
  });

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should reject IngestPipeline with index signature when table=true", function () {
    const source = `
      import { IngestPipeline, Key, DateTime } from "@514labs/moose-lib";
      
      interface UserDataWithExtraFields {
        id: Key<string>;
        timestamp: DateTime;
        email: string;
        [key: string]: any; // Index signature
      }
      
      export const pipeline = new IngestPipeline<UserDataWithExtraFields>("UserData", {
        table: true, // Should fail
        stream: true,
        ingestApi: true,
      });
    `;

    const result = testIngestPipelineValidation(tempDir, source);

    expect(result.success).to.be.false;
    expect(result.error).to.exist;
    expect(result.error).to.include(
      "IngestPipeline cannot use a type with index signatures when 'table' is configured",
    );
    expect(result.error).to.include(
      "Extra fields would be silently dropped when writing to the ClickHouse table",
    );
  });

  it("should allow IngestPipeline with index signature when table=false", function () {
    const source = `
      import { IngestPipeline, Key, DateTime } from "@514labs/moose-lib";
      
      interface UserDataWithExtraFields {
        id: Key<string>;
        timestamp: DateTime;
        email: string;
        [key: string]: any;
      }
      
      export const pipeline = new IngestPipeline<UserDataWithExtraFields>("UserData", {
        table: false, // Should succeed
        stream: true,
        ingestApi: true,
      });
    `;

    const result = testIngestPipelineValidation(tempDir, source);

    expect(result.success).to.be.true;
    expect(result.error).to.be.undefined;
  });

  it("should allow IngestPipeline with fixed schema when table=true", function () {
    const source = `
      import { IngestPipeline, Key, DateTime } from "@514labs/moose-lib";
      
      interface UserDataFixed {
        id: Key<string>;
        timestamp: DateTime;
        email: string;
        name: string;
        // No index signature
      }
      
      export const pipeline = new IngestPipeline<UserDataFixed>("UserData", {
        table: true, // Should succeed
        stream: true,
        ingestApi: true,
      });
    `;

    const result = testIngestPipelineValidation(tempDir, source);

    expect(result.success).to.be.true;
    expect(result.error).to.be.undefined;
  });

  it("should allow IngestPipeline with index signature when table config is an object", function () {
    const source = `
      import { IngestPipeline, Key, DateTime, ClickHouseEngines } from "@514labs/moose-lib";
      
      interface UserDataFixed {
        id: Key<string>;
        timestamp: DateTime;
        email: string;
        // No index signature required when table is explicitly configured
      }
      
      export const pipeline = new IngestPipeline<UserDataFixed>("UserData", {
        table: { 
          orderByFields: ["id"],
          engine: ClickHouseEngines.MergeTree
        },
        stream: true,
        ingestApi: true,
      });
    `;

    const result = testIngestPipelineValidation(tempDir, source);

    expect(result.success).to.be.true;
    expect(result.error).to.be.undefined;
  });

  it("should allow IngestApi and Stream with index signatures", function () {
    const source = `
      import { IngestApi, Stream, Key } from "@514labs/moose-lib";
      
      interface FlexibleData {
        id: Key<string>;
        [key: string]: any; // Index signature OK for IngestApi/Stream
      }
      
      export const stream = new Stream<FlexibleData>("FlexibleData");
      export const api = new IngestApi<FlexibleData>("flexible", {
        destination: stream,
      });
    `;

    const result = testIngestPipelineValidation(tempDir, source);

    expect(result.success).to.be.true;
    expect(result.error).to.be.undefined;
  });

  it("should provide helpful error message with solutions", function () {
    const source = `
      import { IngestPipeline, Key, DateTime } from "@514labs/moose-lib";
      
      interface DataWithIndex {
        id: Key<string>;
        timestamp: DateTime;
        [key: string]: any;
      }
      
      export const pipeline = new IngestPipeline<DataWithIndex>("Data", {
        table: true,
        stream: true,
        ingestApi: true,
      });
    `;

    const result = testIngestPipelineValidation(tempDir, source);

    expect(result.success).to.be.false;
    expect(result.error).to.exist;
    // Check that error message includes both solutions
    expect(result.error).to.include(
      "Remove the index signature from your type to use a fixed schema",
    );
    expect(result.error).to.include(
      "Set 'table: false' in your IngestPipeline config",
    );
  });

  it("should handle numeric index signatures", function () {
    const source = `
      import { IngestPipeline, Key, DateTime } from "@514labs/moose-lib";
      
      interface DataWithNumericIndex {
        id: Key<string>;
        timestamp: DateTime;
        [index: number]: string; // Numeric index signature
      }
      
      export const pipeline = new IngestPipeline<DataWithNumericIndex>("Data", {
        table: true,
        stream: true,
        ingestApi: true,
      });
    `;

    const result = testIngestPipelineValidation(tempDir, source);

    expect(result.success).to.be.false;
    expect(result.error).to.exist;
    expect(result.error).to.include(
      "IngestPipeline cannot use a type with index signatures",
    );
  });
});
