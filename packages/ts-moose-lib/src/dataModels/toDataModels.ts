import ts, { isEnumDeclaration, isInterfaceDeclaration } from "typescript";
import type { PluginConfig, TransformerExtras } from "ts-patch";
import { toColumns } from "./typeConvert";
import * as fs from "node:fs";
import {
  Column,
  DataEnum,
  DataModel,
  IndexType,
  NullType,
  UnknownType,
  UnsupportedEnum,
  UnsupportedFeature,
} from "./dataModelTypes";
import { enumConvert } from "./enumConvert";

const convertSourceFile = (
  sourceFile: ts.SourceFile,
  checker: ts.TypeChecker,
) => {
  const output = {
    models: [] as DataModel[],
    enums: [] as DataEnum[],
  };

  let fileSymbol = checker.getSymbolAtLocation(sourceFile);
  let exports =
    fileSymbol === undefined ?
      [] // empty file
    : checker.getExportsOfModule(fileSymbol);
  exports.forEach((exported) => {
    const declaration = exported.declarations![0];
    if (isInterfaceDeclaration(declaration)) {
      const name = declaration.name.text;
      const t = checker.getTypeAtLocation(declaration);

      const columns: Column[] = toColumns(t, checker);
      output.models.push({
        name,
        columns,
      });
    }
    if (isEnumDeclaration(declaration)) {
      const t = checker.getTypeAtLocation(declaration);
      output.enums.push(enumConvert(t));
    }
  });
  return output;
};

/**
 * Gets the source directory from environment variable or defaults to "app"
 */
function getSourceDir(): string {
  return process.env.MOOSE_SOURCE_DIR || "app";
}

export default function (
  program: ts.Program,
  _pluginConfig: PluginConfig,
  _extras: TransformerExtras,
) {
  const checker = program.getTypeChecker();

  const cwd = program.getCurrentDirectory();
  const dataModelDir = `${cwd}/${getSourceDir()}/datamodels/`;
  const oldVersionDir = `${cwd}/.moose/versions/`;

  const outputDir = `${cwd}/.moose/serialized_datamodels/`;
  fs.mkdirSync(outputDir, { recursive: true });

  return (_ctx: ts.TransformationContext) => {
    return (sourceFile: ts.SourceFile) => {
      if (
        sourceFile.fileName.startsWith(dataModelDir) ||
        sourceFile.fileName.startsWith(oldVersionDir)
      ) {
        let output: any;
        try {
          output = convertSourceFile(sourceFile, checker);
        } catch (e) {
          if (e instanceof UnknownType) {
            output = {
              error_type: "unknown_type",
              field: e.fieldName,
              parent: e.typeName,
              type: e.t.getSymbol()?.name,
            };
          } else if (e instanceof NullType) {
            output = {
              error_type: "unknown_type",
              field: e.fieldName,
              parent: e.typeName,
              type: "null",
            };
          } else if (e instanceof IndexType) {
            output = {
              error_type: "index_type",
              type: e.typeName,
              index_signatures: e.indexSignatures,
            };
          } else if (e instanceof UnsupportedEnum) {
            output = {
              error_type: "unsupported_enum",
              type_name: e.enumName,
            };
          } else if (e instanceof UnsupportedFeature) {
            output = {
              error_type: "unsupported_feature",
              feature_name: e.featureName,
            };
          } else {
            throw e;
          }
        }
        const nameWithoutExtension = sourceFile.fileName
          .slice(sourceFile.fileName.lastIndexOf("/"))
          .replace(/\.ts$/, "");

        fs.writeFileSync(
          `${outputDir}/${nameWithoutExtension}.json`,
          JSON.stringify(output),
          "utf8",
        );
      }

      return sourceFile;
    };
  };
}
