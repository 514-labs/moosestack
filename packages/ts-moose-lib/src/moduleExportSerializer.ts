import { getSourceDir, shouldUseCompiled, loadModule } from "./compiler-config";

export async function runExportSerializer(targetModel: string) {
  const useCompiled = shouldUseCompiled();
  const sourceDir = getSourceDir();

  // Transform path if using compiled mode
  let modulePath = targetModel;
  if (useCompiled) {
    // Replace source directory with compiled path and .ts with .js
    // Handle both absolute paths (starting with /) and relative paths
    if (modulePath.includes(sourceDir)) {
      modulePath = modulePath.replace(
        new RegExp(`/${sourceDir}/`),
        `/.moose/compiled/${sourceDir}/`,
      );
    }
    // Replace .ts extension with .js
    modulePath = modulePath.replace(/\.ts$/, ".js");
  }

  // Use dynamic loader that handles both CJS and ESM
  const exports_list = await loadModule(modulePath);
  console.log(JSON.stringify(exports_list));
}
