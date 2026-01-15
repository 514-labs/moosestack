import process from "process";
import { getSourceDir } from "../compiler-config";

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
