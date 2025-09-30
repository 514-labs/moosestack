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
      if (fileCache.has(fileName)) return fileCache.get(fileName);

      const sourceFile = originalGetSourceFile.apply(
        void 0,
        Array.from(arguments) as any,
      );
      fileCache.set(fileName, sourceFile);

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

export const replaceProgram =
  (
    transform: (
      typeChecker: ts.TypeChecker,
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
    const transformFunction = transform(program.getTypeChecker());

    const compilerOptions = program.getCompilerOptions();

    const compilerHost = getPatchedHost(host, tsInstance, compilerOptions);
    const rootFileNames = program
      .getRootFileNames()
      .map(tsInstance.server.toNormalizedPath);

    const transformedSource = tsInstance.transform(
      program.getSourceFiles().filter(
        (sourceFile) =>
          // relative path, or
          !sourceFile.fileName.startsWith("/") ||
          // current directory but not in node_modules
          (sourceFile.fileName.startsWith(`${process.cwd()}`) &&
            !sourceFile.fileName.startsWith(`${process.cwd()}/node_modules`)),
      ),
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
      (updatedSourceFile as any).version = (sourceFile as any).version;
      compilerHost.fileCache.set(fileName, updatedSourceFile);
    }

    return tsInstance.createProgram(
      rootFileNames,
      compilerOptions,
      compilerHost,
    );
  };

export const avoidTypiaNameClash = "____moose____typia";

export const typiaJsonSchemas = (typeNode: TypeNode) =>
  factory.createCallExpression(
    factory.createPropertyAccessExpression(
      factory.createPropertyAccessExpression(
        factory.createIdentifier(avoidTypiaNameClash),
        factory.createIdentifier("json"),
      ),
      factory.createIdentifier("schemas"),
    ),
    [factory.createTupleTypeNode([typeNode])],
    [],
  );
