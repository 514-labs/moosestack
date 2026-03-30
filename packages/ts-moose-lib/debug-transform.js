const ts = require("typescript");
const fs = require("fs");
const path = require("path");

const configPath =
  "/home/omar_rahman/TTD.ClickHouse.Cluster.Agiles/TTD.ClickHouse.Cluster.Agiles/moose/tsconfig.json";
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
const parsedCommandLine = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  path.dirname(configPath),
);

const program = ts.createProgram({
  rootNames: parsedCommandLine.fileNames,
  options: parsedCommandLine.options,
});

const checker = program.getTypeChecker();
const sourceFile = program.getSourceFile(
  "/home/omar_rahman/TTD.ClickHouse.Cluster.Agiles/TTD.ClickHouse.Cluster.Agiles/moose/app/tables/rtiAdGroupSpendHealth.ts",
);

const transformerFactory =
  require("/home/omar_rahman/moosefork/moosestack/packages/ts-moose-lib/dist/compilerPlugin.js").default;

const context = {
  getCompilerOptions: () => parsedCommandLine.options,
  factory: ts.factory,
  onSubstituteNode: () => {},
  onEmitNode: () => {},
  readEmitHelpers: () => undefined,
  requestEmitHelper: () => {},
};

try {
  console.log("Creating transformer factory...");
  const factory = transformerFactory(program, undefined, { ts });
  console.log("Created factory, trying to transform...");
  const transformer = factory(context);
  const result = transformer(sourceFile);

  console.log("Original nodes:", sourceFile.statements.length);
  console.log("Transformed nodes:", result.statements.length);

  // Check if any OlapTable imports or instantiations changed
  const printer = ts.createPrinter();
  const resultCode = printer.printFile(result);
  console.log(
    "Does transformed code have type arguments for OlapTable?",
    resultCode.includes("OlapTable<amt_RtiAdGroupSpendHealth>"),
  );

  // Write out the result to see what it actually did
  fs.writeFileSync("transformed_output.ts", resultCode);
  console.log("Wrote transformed file to transformed_output.ts");
} catch (e) {
  console.error("Error during transformation:", e);
}
