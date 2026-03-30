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

const stmt = sourceFile.statements.find(
  (s) =>
    ts.isVariableStatement(s) &&
    s.declarationList.declarations[0].name.text.includes("Table"),
);
const expr = stmt.declarationList.declarations[0].initializer;

const {
  isNewMooseResourceWithTypeParam,
  transformNewMooseResource,
} = require("/home/omar_rahman/moosefork/moosestack/packages/ts-moose-lib/dist/compilerPlugin.js");
console.log(
  "Checking modified plugin export again:",
  !!isNewMooseResourceWithTypeParam,
);
