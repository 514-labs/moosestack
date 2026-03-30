import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/browserCompatible.ts",
    "src/dataModels/toDataModels.ts",
    "src/scripts/workflow.ts",
    "src/compilerPlugin.ts",
    "src/moose-tspc.ts",
    "src/moose-runner.ts",
    "src/dmv2/index.ts",
    "src/testing/index.ts",
  ],
  format: ["cjs", "esm"],
  dts: true, // Generate declaration file (.d.ts)
  outDir: "dist",
  splitting: false,
  sourcemap: true,
  clean: true,
});
