import { getSourceDir, shouldUseCompiled } from "./compiler-config";

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

  const exports_list = require(modulePath);
  console.log(JSON.stringify(exports_list));
}
