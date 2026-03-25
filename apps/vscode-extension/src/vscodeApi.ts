export function getVscodeApi(): typeof import("vscode") {
  return require("vscode") as typeof import("vscode");
}
