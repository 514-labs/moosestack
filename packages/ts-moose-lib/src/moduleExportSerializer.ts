import { getSourceDir, getOutDir, loadModule } from "./compiler-config";

export async function runExportSerializer(targetModel: string) {
  const sourceDir = getSourceDir();
  const outDir = getOutDir();

  // Always use compiled paths - replace source directory with compiled path
  let modulePath = targetModel;

  // Replace source directory with compiled path and .ts with .js
  // Handle both absolute paths (starting with /) and relative paths
  // Use string replacement instead of RegExp to avoid ReDoS risk
  const sourcePattern = `/${sourceDir}/`;
  if (modulePath.includes(sourcePattern)) {
    modulePath = modulePath.replace(sourcePattern, `/${outDir}/${sourceDir}/`);
  }
  // Replace .ts extension with .js
  modulePath = modulePath.replace(/\.ts$/, ".js");

  // Use dynamic loader that handles both CJS and ESM
  const exports_list = await loadModule(modulePath);
  console.log(JSON.stringify(exports_list));
}
