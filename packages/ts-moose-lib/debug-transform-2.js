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

let modifiedNodes = 0;

const customContext = {
  getCompilerOptions: () => parsedCommandLine.options,
  factory: ts.factory,
  onSubstituteNode: (hint, node) => node,
  onEmitNode: (hint, node, emitCallback) => {
    emitCallback(hint, node);
  },
  readEmitHelpers: () => undefined,
  requestEmitHelper: () => {},
};

try {
  const factory = transformerFactory(program, undefined, { ts });
  const transformer = factory(customContext);
  const result = transformer(sourceFile);

  const printer = ts.createPrinter();
  const resultCode = printer.printFile(result);
  console.log(
    "Transformed result includes schemas?",
    resultCode.includes('{"type":"object"'),
  );
  if (!resultCode.includes('{"type":"object"')) {
    console.log("THE SCHEMA WAS NOT INJECTED!");
  } else {
    console.log("SCHEMA WAS INJECTED IN MANUAL RUN.");
  }
} catch (e) {
  console.error("Error during transformation:", e);
}
