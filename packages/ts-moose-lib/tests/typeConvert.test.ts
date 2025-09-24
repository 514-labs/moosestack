import { expect } from "chai";
import ts from "typescript";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { toColumns } from "../src/dataModels/typeConvert";

function createProgramWithSource(tempDir: string, sourceText: string) {
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

  const program = ts.createProgram({
    rootNames: [
      srcFile,
      path.resolve(__dirname, "../src/browserCompatible.ts"),
    ],
    options: compilerOptions,
  });

  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(srcFile)!;

  const interfaceDecl = sourceFile.statements.find(
    (s): s is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(s) && s.name.text === "TestModel",
  );
  if (!interfaceDecl) throw new Error("TestModel interface not found");
  const type = checker.getTypeAtLocation(interfaceDecl);
  return { checker, type };
}

describe("typeConvert mappings for helper types", () => {
  it("maps DateTime, DateTime64, numeric aliases, Decimal and LowCardinality", function() {
    this.timeout(20000); // Increase timeout for TypeScript compilation
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moose-typeconv-"));

    const source = `
      import { DateTime, DateTime64, Int8, UInt16, Float32, Float64, Decimal, LowCardinality } from "@514labs/moose-lib";

      export interface TestModel {
        dt: DateTime;
        dtMs: DateTime64<3>;
        i8: Int8;
        u16: UInt16;
        f32: Float32;
        f64: Float64;
        price: Decimal<10, 2>;
        status: string & LowCardinality;
      }
    `;

    const { checker, type } = createProgramWithSource(tempDir, source);
    const columns = toColumns(type, checker);
    const byName: Record<string, any> = Object.fromEntries(
      columns.map((c) => [c.name, c]),
    );

    expect(byName.dt.data_type).to.equal("DateTime");
    expect(byName.dtMs.data_type).to.equal("DateTime(3)");

    expect(byName.i8.data_type).to.equal("Int8");
    expect(byName.u16.data_type).to.equal("UInt16");
    expect(byName.f32.data_type).to.equal("Float32");
    expect(byName.f64.data_type).to.equal("Float64");

    expect(byName.price.data_type).to.equal("Decimal(10, 2)");

    expect(byName.status.data_type).to.equal("String");
    expect(byName.status.annotations).to.deep.include(["LowCardinality", true]);
  });

  it('maps Date & Aggregated<"argMax", [Date, Date]> to AggregateFunction(argMax, DateTime, DateTime)', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moose-typeconv-"));

    const source = `
      import { Aggregated } from "@514labs/moose-lib";

      export interface TestModel {
        // return type is Date, but AggregateFunction argument types should be DateTime, DateTime
        created: Date & Aggregated<"argMax", [Date, Date]>;
      }
    `;

    const { checker, type } = createProgramWithSource(tempDir, source);
    const columns = toColumns(type, checker);
    expect(columns).to.have.length(1);
    const col = columns[0];

    // Column data type for Date should remain DateTime (framework default)
    expect(col.data_type).to.equal("DateTime");

    // Aggregation annotation should be present and use DateTime for arguments
    const agg = col.annotations.find(([k]) => k === "aggregationFunction");
    expect(agg).to.not.be.undefined;
    const aggPayload = (agg as any)[1];

    expect(aggPayload.functionName).to.equal("argMax");
    expect(aggPayload.argumentTypes).to.deep.equal(["DateTime", "DateTime"]);
  });

  it('maps DateTime64<3> & Aggregated<"argMax", [DateTime64<3>, DateTime64<6>]> to preserve precision', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moose-typeconv-"));

    const source = `
      import { Aggregated, DateTime64 } from "@514labs/moose-lib";

      export interface TestModel {
        // Test that DateTime64 with precision is preserved in aggregation arguments
        created: DateTime64<3> & Aggregated<"argMax", [DateTime64<3>, DateTime64<6>]>;
      }
    `;

    const { checker, type } = createProgramWithSource(tempDir, source);
    const columns = toColumns(type, checker);
    expect(columns).to.have.length(1);
    const col = columns[0];

    // Column data type should be DateTime(3) for DateTime64<3>
    expect(col.data_type).to.equal("DateTime(3)");

    // Aggregation annotation should preserve the DateTime64 precisions
    const agg = col.annotations.find(([k]) => k === "aggregationFunction");
    expect(agg).to.not.be.undefined;
    const aggPayload = (agg as any)[1];

    expect(aggPayload.functionName).to.equal("argMax");
    expect(aggPayload.argumentTypes).to.deep.equal([
      "DateTime(3)",
      "DateTime(6)",
    ]);
  });
});
