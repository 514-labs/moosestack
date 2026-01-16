import process from "process";
import { getSourceDir, shouldUseCompiled, loadModule } from "../compiler-config";

export async function runApiTypeSerializer(targetModel: string) {
  const sourceDir = getSourceDir();
  const useCompiled = shouldUseCompiled();

  // Build path based on compilation mode
  const apiPath = useCompiled
    ? `${process.cwd()}/.moose/compiled/${sourceDir}/apis/${targetModel}.js`
    : `${process.cwd()}/${sourceDir}/apis/${targetModel}.ts`;

  // Use dynamic loader that handles both CJS and ESM
  const module = await loadModule(apiPath);
  const func = module.default;
  const inputSchema = func["moose_input_schema"] || null;
  const outputSchema = func["moose_output_schema"] || null;
  console.log(
    JSON.stringify({
      inputSchema,
      outputSchema,
    }),
  );
}
