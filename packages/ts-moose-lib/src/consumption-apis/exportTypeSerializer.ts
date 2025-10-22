import process from "process";

/**
 * Gets the source directory from environment variable or defaults to "app"
 */
function getSourceDir(): string {
  return process.env.MOOSE_SOURCE_DIR || "app";
}

export async function runApiTypeSerializer(targetModel: string) {
  const func = require(
    `${process.cwd()}/${getSourceDir()}/apis/${targetModel}.ts`,
  ).default;
  const inputSchema = func["moose_input_schema"] || null;
  const outputSchema = func["moose_output_schema"] || null;
  console.log(
    JSON.stringify({
      inputSchema,
      outputSchema,
    }),
  );
}
