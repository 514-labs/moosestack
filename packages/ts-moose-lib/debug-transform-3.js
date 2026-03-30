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

  // find OlapTable nodes in result to see if arguments were appended
  const printer = ts.createPrinter();
  let found = false;

  function visit(node) {
    if (ts.isNewExpression(node)) {
      const exprName =
        node.expression.escapedText ||
        (node.expression.name && node.expression.name.escapedText) ||
        "unknown";
      if (exprName === "OlapTable" || exprName === "unknown") {
        console.log(
          "Found NewExpression arguments length:",
          node.arguments.length,
        );
        console.log(printer.printNode(ts.EmitHint.Unspecified, node, result));
        found = true;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(result);

  if (!found) {
    console.log("No OlapTable new expressions found in output");
  }
} catch (e) {
  console.error("Error during transformation:", e);
}
