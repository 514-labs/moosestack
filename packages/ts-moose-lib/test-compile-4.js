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

const decls = program
  .getSourceFiles()
  .filter((f) => f.fileName.includes("OlapTable"));
console.log(
  "Files with OlapTable:",
  decls.map((f) => f.fileName),
);

console.log("Trying to find the symbol for OlapTable:");
function visit(node) {
  if (ts.isNewExpression(node)) {
    const sym = checker.getSymbolAtLocation(node.expression);
    console.log(
      "Symbol declarations:",
      sym?.declarations?.map((d) => d.getSourceFile().fileName),
    );
  }
  ts.forEachChild(node, visit);
}

visit(sourceFile);
