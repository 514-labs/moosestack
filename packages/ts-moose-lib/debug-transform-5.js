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

  let hasSchemas = false;
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      node.expression.getText &&
      node.expression.getText() === "JSON.parse"
    ) {
      console.log("Found JSON.parse call:");
      console.log(node.arguments[0].text.substring(0, 100));
      hasSchemas = true;
    } else if (
      ts.isStringLiteral(node) &&
      node.text.includes('"type":"object"')
    ) {
      console.log("Found typia JSON schema string!");
      hasSchemas = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(result);

  if (!hasSchemas) {
    console.log("No schemas found in transformed AST");
  } else {
    console.log("Schemas WERE injected!");
  }
} catch (e) {
  console.error("Error during transformation:", e);
}
