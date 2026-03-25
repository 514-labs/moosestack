import path from "node:path";

export function isPathInsideRoot(
  rootPath: string,
  candidatePath: string,
): boolean {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedCandidate = path.resolve(candidatePath);
  const relativePath = path.relative(normalizedRoot, normalizedCandidate);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

export function isSingleDirectoryName(value: string): boolean {
  const trimmedValue = value.trim();

  return (
    trimmedValue.length > 0 &&
    trimmedValue !== "." &&
    trimmedValue !== ".." &&
    trimmedValue === path.basename(trimmedValue) &&
    !/[\\/]/.test(trimmedValue)
  );
}
