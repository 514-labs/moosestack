import ts, { factory, TypeNode } from "typescript";
import path from "path";
import { PluginConfig, ProgramTransformerExtras } from "ts-patch";
import process from "process";
import fs from "node:fs";

export const getPatchedHost = (
  maybeHost: ts.CompilerHost | undefined,
  tsInstance: typeof ts,
  compilerOptions: ts.CompilerOptions,
): ts.CompilerHost & { fileCache: Map<string, ts.SourceFile> } => {
  const fileCache = new Map();
  const compilerHost =
    maybeHost ?? tsInstance.createCompilerHost(compilerOptions, true);
  const originalGetSourceFile = compilerHost.getSourceFile;

  return Object.assign(compilerHost, {
    getSourceFile(fileName: string, languageVersion: ts.ScriptTarget) {
      fileName = tsInstance.server.toNormalizedPath(fileName);
      // Only return cached file if explicitly set by transformer
      // Don't cache on initial read to allow fresh reads on incremental builds
      if (fileCache.has(fileName)) return fileCache.get(fileName);

      const sourceFile = originalGetSourceFile.apply(
        void 0,
        Array.from(arguments) as any,
      );
      // Don't cache here - only cache transformed files in replaceProgram
      return sourceFile;
    },
    fileCache,
  });
};

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

/**
 * Context passed to transformation functions
 */
export interface TransformContext {
  typeChecker: ts.TypeChecker;
  program: ts.Program;
}

export const replaceProgram =
  (
    transform: (
      ctx: TransformContext,
    ) => (
      _context: ts.TransformationContext,
    ) => (sourceFile: ts.SourceFile) => ts.SourceFile,
  ) =>
  (
    program: ts.Program,
    host: ts.CompilerHost | undefined,
    config: PluginConfig,
    { ts: tsInstance }: ProgramTransformerExtras,
  ): ts.Program => {
    const compilerOptions = program.getCompilerOptions();
    const rootFileNames = program
      .getRootFileNames()
      .map(tsInstance.server.toNormalizedPath);

    // Create a FRESH program by reading source files from disk
    // This works around a ts-patch bug where incremental compilation
    // passes stale transformed source files
    const freshHost = tsInstance.createCompilerHost(compilerOptions, true);
    const freshProgram = tsInstance.createProgram(
      rootFileNames,
      compilerOptions,
      freshHost,
    );

    // Set versions on fresh source files (required for watch mode builder)
    const crypto = require("crypto");
    for (const sf of freshProgram.getSourceFiles()) {
      if (!(sf as any).version) {
        const content = sf.getFullText();
        (sf as any).version = crypto
          .createHash("sha256")
          .update(content)
          .digest("hex");
      }
    }

    // Now create the patched host for our output
    const compilerHost = getPatchedHost(host, tsInstance, compilerOptions);

    // Create transform context with FRESH program
    const transformCtx: TransformContext = {
      typeChecker: freshProgram.getTypeChecker(),
      program: freshProgram,
    };

    const transformFunction = transform(transformCtx);

    // Get source files from FRESH program
    const rootSourceFiles = freshProgram
      .getSourceFiles()
      .filter((sourceFile) =>
        rootFileNames.includes(sourceFile.fileName as any),
      );

    const transformedSource = tsInstance.transform(
      rootSourceFiles,
      [transformFunction],
      compilerOptions,
    ).transformed;

    const { printFile } = tsInstance.createPrinter();
    for (const sourceFile of transformedSource) {
      const { fileName, languageVersion } = sourceFile;
      const newFile = printFile(sourceFile);

      try {
        const path = fileName.split("/").pop() || fileName;
        const dir = `${process.cwd()}/.moose/api-compile-step/`;
        fs.mkdirSync(dir, {
          recursive: true,
        });
        fs.writeFileSync(`${dir}/${path}`, newFile);
      } catch (e) {
        // this file is just for debugging purposes
        // TODO even printing in std err will fail the import process
      }

      const updatedSourceFile = tsInstance.createSourceFile(
        fileName,
        newFile,
        languageVersion,
      );
      // Copy version from original - but add suffix to invalidate ts-patch cache
      // This ensures ts-patch sees transformed files as different versions
      const originalVersion = (sourceFile as any).version;
      (updatedSourceFile as any).version =
        originalVersion ? `${originalVersion}-moose-transformed` : undefined;
      compilerHost.fileCache.set(fileName, updatedSourceFile);
    }

    return tsInstance.createProgram(
      rootFileNames,
      compilerOptions,
      compilerHost,
    );
  };

export const avoidTypiaNameClash = "____moose____typia";

// Wraps a type parameter with import("@514labs/moose-lib").StripDateIntersection<>
export const sanitizeTypeParameter = (typeNode: TypeNode): ts.ImportTypeNode =>
  factory.createImportTypeNode(
    factory.createLiteralTypeNode(
      factory.createStringLiteral("@514labs/moose-lib"),
    ),
    undefined,
    factory.createIdentifier("StripDateIntersection"),
    [typeNode],
    false,
  );

// Typia call generators for transformed code
export const typiaJsonSchemas = (typeNode: TypeNode) =>
  factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier(avoidTypiaNameClash),
        factory.createIdentifier("json"),
      ),
      factory.createIdentifier("schemas"),
    ),
    [factory.createTupleTypeNode([sanitizeTypeParameter(typeNode)])],
    [],
  );
