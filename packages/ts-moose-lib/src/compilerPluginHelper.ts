import ts from "typescript";
import path from "path";
import { PluginConfig, TransformerExtras } from "ts-patch";
import process from "process";
import fs from "node:fs";

export const isMooseFile = (sourceFile: ts.SourceFile): boolean => {
  const location: string = path.resolve(sourceFile.fileName);

  return (
    location.includes("@514labs/moose-lib") ||
    // workaround for e2e test
    location.includes("packages/ts-moose-lib/dist") ||
    // support local development with symlinked packages
    location.includes("packages/ts-moose-lib/src")
  );
};

import type { TypiaDirectContext } from "./typiaDirectIntegration";

/**
 * Context passed to transformation functions
 */
export interface TransformContext {
  typeChecker: ts.TypeChecker;
  program: ts.Program;
  /** Shared typia context for direct code generation - created per-file */
  typiaContext: TypiaDirectContext;
}

/**
 * Creates a regular TypeScript transformer (not a program transformer).
 * This is simpler and works better with incremental compilation since
 * we're not replacing the entire program.
 */
export const createTransformer =
  (
    transform: (
      typeChecker: ts.TypeChecker,
      program: ts.Program,
    ) => (
      _context: ts.TransformationContext,
    ) => (sourceFile: ts.SourceFile) => ts.SourceFile,
  ) =>
  (
    program: ts.Program,
    _configOrHost: PluginConfig | ts.CompilerHost | undefined,
    _extrasOrConfig: TransformerExtras | PluginConfig,
    maybeProgramExtras?: unknown,
  ): ts.TransformerFactory<ts.SourceFile> => {
    // Detect if called with transformProgram: true (4 args) vs regular transformer (3 args)
    // transformProgram signature: (program, host, config, extras) => Program
    // regular signature: (program, config, extras) => TransformerFactory
    if (maybeProgramExtras !== undefined) {
      throw new Error(
        `[moose] Your tsconfig.json has "transformProgram": true for the moose plugin, ` +
          `but this version requires "transformProgram": false (or remove it entirely).\n\n` +
          `Update your tsconfig.json plugins section:\n` +
          `  "plugins": [\n` +
          `    { "transform": "./node_modules/@514labs/moose-lib/dist/compilerPlugin.js" },\n` +
          `    { "transform": "typia/lib/transform" }\n` +
          `  ]\n\n` +
          `Also remove "isolatedModules": true if present (incompatible with type-dependent transformations).`,
      );
    }

    const transformFunction = transform(program.getTypeChecker(), program);

    // Return a transformer factory
    return (context: ts.TransformationContext) => {
      return (sourceFile: ts.SourceFile) => {
        // Skip node_modules and declaration files
        const cwd = process.cwd();
        if (
          sourceFile.isDeclarationFile ||
          sourceFile.fileName.includes("/node_modules/")
        ) {
          return sourceFile;
        }

        // Only transform files in the current project
        if (
          sourceFile.fileName.startsWith("/") &&
          !sourceFile.fileName.startsWith(cwd)
        ) {
          return sourceFile;
        }

        // Apply transformation
        const result = transformFunction(context)(sourceFile);

        // Debug: write transformed source to .moose/api-compile-step/
        try {
          const printer = ts.createPrinter();
          const newFile = printer.printFile(result);
          const fileName =
            sourceFile.fileName.split("/").pop() || sourceFile.fileName;
          const dir = `${process.cwd()}/.moose/api-compile-step/`;
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(`${dir}/${fileName}`, newFile);
        } catch (_e) {
          // Debug output is optional
        }

        return result;
      };
    };
  };

export const avoidTypiaNameClash = "____moose____typia";
