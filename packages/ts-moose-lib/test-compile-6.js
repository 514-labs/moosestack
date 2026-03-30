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

console.log("TypeScript loading node_modules:", program.getCompilerOptions());

const checker = program.getTypeChecker();
const sourceFile = program.getSourceFile(
  "/home/omar_rahman/TTD.ClickHouse.Cluster.Agiles/TTD.ClickHouse.Cluster.Agiles/moose/app/tables/rtiAdGroupSpendHealth.ts",
);

const sym = checker.getSymbolAtLocation(
  sourceFile.statements[0].moduleSpecifier,
);
console.log("Import symbol:", sym?.name, sym?.declarations?.length);
