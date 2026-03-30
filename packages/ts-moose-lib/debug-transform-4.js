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

const {
  isNewMooseResourceWithTypeParam,
} = require("/home/omar_rahman/moosefork/moosestack/packages/ts-moose-lib/dist/compilerPlugin.js");

let foundNewExpression = false;
let foundOlapTable = false;
let failedHasTypeArgs = false;
let hasTypeArgsVal = false;

function visit(node) {
  if (ts.isNewExpression(node)) {
    foundNewExpression = true;
    const sym = checker.getSymbolAtLocation(node.expression);
    const typeName = sym?.name ?? "";
    if (typeName === "OlapTable") {
      foundOlapTable = true;

      console.log("Found OlapTable!");

      const typesToArgsLength = new Map([
        ["OlapTable", 2],
        ["Stream", 2],
        ["DeadLetterQueue", 2],
        ["IngestPipeline", 2],
        ["IngestApi", 2],
        ["Api", 2],
        ["MaterializedView", 1],
        ["Task", 2],
      ]);

      const expectedArgLength = typesToArgsLength.get(typeName);
      const actualArgLength = node.arguments.length;
      console.log(
        "actualArgLength:",
        actualArgLength,
        "expected:",
        expectedArgLength,
      );

      const isUntransformed =
        actualArgLength === expectedArgLength - 1 ||
        actualArgLength === expectedArgLength;
      console.log("isUntransformed:", isUntransformed);

      console.log("typeArguments length:", node.typeArguments?.length);

      // This is exactly what the code does
      const result = isUntransformed && node.typeArguments?.length === 1;
      console.log("Return value should be:", result);
    }
  }
  ts.forEachChild(node, visit);
}

visit(sourceFile);
