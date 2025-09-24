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
  it("maps DateTime, DateTime64, numeric aliases, Decimal and LowCardinality", () => {
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

  it("maps Aggregated with Date args to AggregateFunction(argMax, Date32, Date32)", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "moose-typeconv-"));

    const source = `
      import { Aggregated } from "@514labs/moose-lib";

      export interface TestModel {
        // result type is Date (should remain DateTime by default for direct fields)
        // but argument types for Aggregated should resolve Date -> Date (Date32)
        created: Date & Aggregated<"argMax", [Date, Date]>;
      }
    `;

    const { checker, type } = createProgramWithSource(tempDir, source);
    const columns = toColumns(type, checker);
    const byName: Record<string, any> = Object.fromEntries(
      columns.map((c) => [c.name, c]),
    );

    // Ensure aggregation annotation is present
    const ann = byName.created.annotations.find(
      ([k]) => k === "aggregationFunction",
    );
    expect(ann).to.not.equal(undefined);
    const agg = ann![1];
    expect(agg.functionName).to.equal("argMax");
    // Expect both argument types mapped to Date (ClickHouse Date32)
    expect(agg.argumentTypes).to.deep.equal(["Date", "Date"]);
  });
});
