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

function isMooseFile(sourceFile) {
  const location = path.resolve(sourceFile.fileName);
  return (
    location.includes("@514labs/moose-lib") ||
    location.includes("packages/ts-moose-lib/dist") ||
    location.includes("packages/ts-moose-lib/src") ||
    location.includes("vendor/ts-moose-lib") ||
    location.includes("ts-moose-lib")
  );
}

function visit(node) {
  if (ts.isNewExpression(node)) {
    const sym = checker.getSymbolAtLocation(node.expression);
    console.log("Found NewExpression:", sym?.name);

    const sig = checker.getResolvedSignature(node);
    if (sig) {
      const decl = sig.declaration;
      if (decl) {
        const file = decl.getSourceFile();
        console.log("  Declaration in file:", file.fileName);
        console.log("  isMooseFile?", isMooseFile(file));
      }
    }
  }
  ts.forEachChild(node, visit);
}

visit(sourceFile);
