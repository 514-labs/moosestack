import fs from "node:fs";
import path from "node:path";

function resolveRealPath(filePath: string): string {
  return fs.realpathSync(filePath);
}

function resolveCandidateRealPath(candidatePath: string): string {
  const resolvedCandidatePath = path.resolve(candidatePath);
  const trailingSegments: string[] = [];
  let existingAncestorPath = resolvedCandidatePath;

  while (!fs.existsSync(existingAncestorPath)) {
    const parentPath = path.dirname(existingAncestorPath);
    if (parentPath === existingAncestorPath) {
      throw new Error(
        `Could not find an existing ancestor for path ${candidatePath}`,
      );
    }

    trailingSegments.unshift(path.basename(existingAncestorPath));
    existingAncestorPath = parentPath;
  }

  let realCandidatePath = resolveRealPath(existingAncestorPath);
  for (const segment of trailingSegments) {
    realCandidatePath = path.join(realCandidatePath, segment);
  }

  return realCandidatePath;
}

export function isPathInsideRoot(
  rootPath: string,
  candidatePath: string,
): boolean {
  const normalizedRoot = resolveRealPath(path.resolve(rootPath));
  const normalizedCandidate = resolveCandidateRealPath(candidatePath);
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
