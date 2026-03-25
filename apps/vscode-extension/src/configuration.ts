import fs from "node:fs";
import path from "node:path";

import type {
  ExtensionsFile,
  JsonValue,
  SettingsFile,
  SqlToolsConnection,
} from "./types";

export function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

export function mergeUniqueStrings(
  baseValues: readonly string[] = [],
  nextValues: readonly string[] = [],
): string[] {
  return Array.from(
    new Set([...(baseValues ?? []), ...(nextValues ?? [])]),
  ).sort();
}

function mergeSqlToolsConnections(
  existingConnections: readonly SqlToolsConnection[] = [],
  sharedConnections: readonly SqlToolsConnection[] = [],
): SqlToolsConnection[] {
  const merged = new Map<string, SqlToolsConnection>();

  for (const connection of [...sharedConnections, ...existingConnections]) {
    if (!connection?.name) {
      continue;
    }

    merged.set(connection.name, connection);
  }

  return Array.from(merged.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function mergeSettings(
  existingSettings: SettingsFile = {},
  sharedSettings: SettingsFile = {},
): SettingsFile {
  return {
    ...sharedSettings,
    ...existingSettings,
    "python.analysis.extraPaths": mergeUniqueStrings(
      existingSettings["python.analysis.extraPaths"],
      sharedSettings["python.analysis.extraPaths"],
    ),
    "sqltools.connections": mergeSqlToolsConnections(
      existingSettings["sqltools.connections"],
      sharedSettings["sqltools.connections"],
    ),
  };
}

export function mergeExtensions(
  existingExtensions: ExtensionsFile = {},
  sharedExtensions: ExtensionsFile = {},
): ExtensionsFile {
  return {
    ...existingExtensions,
    ...sharedExtensions,
    recommendations: mergeUniqueStrings(
      existingExtensions.recommendations,
      sharedExtensions.recommendations,
    ),
    unwantedRecommendations: mergeUniqueStrings(
      existingExtensions.unwantedRecommendations,
      sharedExtensions.unwantedRecommendations,
    ),
  };
}

export function ensureJsonFile(filePath: string, content: JsonValue): boolean {
  const normalized = `${JSON.stringify(content, null, 2)}\n`;
  const existing =
    fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;

  if (existing === normalized) {
    return false;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, normalized);
  return true;
}
