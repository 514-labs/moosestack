import { register } from "ts-node";

register({
  require: ["tsconfig-paths/register"],
  esm: true,
  experimentalTsImportSpecifiers: true,
  compiler: "ts-patch/compiler",
  compilerOptions: {
    paths: { "@514labs/moose-lib": ["./src/"] },
    plugins: [
      {
        transform: `./dist/compilerPlugin.js`,
        transformProgram: true,
      },
      {
        transform: "typia/lib/transform",
      },
    ],
    experimentalDecorators: true,
  },
});
