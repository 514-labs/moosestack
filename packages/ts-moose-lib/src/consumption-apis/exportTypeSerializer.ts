import process from "process";

export async function runApiTypeSerializer(targetModel: string) {
  const func = require(`${process.cwd()}/app/apis/${targetModel}.ts`).default;
  const inputSchema = func["moose_input_schema"] || null;
  const outputSchema = func["moose_output_schema"] || null;
  console.log(
    JSON.stringify({
      inputSchema,
      outputSchema,
    }),
  );
}
