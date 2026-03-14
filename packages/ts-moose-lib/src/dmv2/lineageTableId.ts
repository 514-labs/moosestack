import process from "node:process";

export const DEFAULT_DATABASE_ENV_VAR = "MOOSE_DEFAULT_DATABASE";

export function resolveDefaultLineageDatabase(): string {
  const configured = process.env[DEFAULT_DATABASE_ENV_VAR]?.trim();
  return configured && configured.length > 0 ? configured : "local";
}

export function resolveLineageDatabase(
  explicitDatabase: string | undefined,
  defaultDatabase: string,
): string {
  const configured = explicitDatabase?.trim();
  return configured && configured.length > 0 ? configured : defaultDatabase;
}

export function normalizeLineageVersion(
  version: string | undefined,
): string | undefined {
  return version ? version.replace(/\./g, "_") : undefined;
}

export function inferVersionFromRegistryId(
  tableName: string,
  registryId: string,
): string | undefined {
  const prefix = `${tableName}_`;
  if (!registryId.startsWith(prefix)) {
    return undefined;
  }
  const suffix = registryId.slice(prefix.length);
  return suffix.length > 0 ? suffix : undefined;
}

export function buildCanonicalLineageTableId(
  tableName: string,
  version: string | undefined,
  database: string,
): string {
  const versionSuffix = normalizeLineageVersion(version);
  return versionSuffix ?
      `${database}_${tableName}_${versionSuffix}`
    : `${database}_${tableName}`;
}
