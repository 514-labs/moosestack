/**
 * Query result snapshot helpers for correctness validation.
 * Save a known-good result set, then compare against it on future runs.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * Compute a deterministic SHA-256 hash of a result set.
 * Rows are serialized with recursively sorted keys and then sorted
 * lexicographically so that row order and key insertion order do not
 * affect the hash.
 */
export function hashResultSet(rows: unknown[]): string {
  const sorted = rows.map((r) => JSON.stringify(r, sortKeysReplacer)).sort();
  return createHash("sha256").update(sorted.join("\n")).digest("hex");
}

/** JSON replacer that sorts object keys at every nesting level.
 *  Leaves Date, RegExp, and other non-plain objects to their default toJSON. */
function sortKeysReplacer(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce(
        (acc, k) => {
          acc[k] = (value as Record<string, unknown>)[k];
          return acc;
        },
        {} as Record<string, unknown>,
      );
  }
  return value;
}

export async function saveSnapshot(
  name: string,
  rows: unknown[],
  snapshotsDir: string,
): Promise<string> {
  await mkdir(snapshotsDir, { recursive: true });
  const snapshot = {
    name,
    savedAt: new Date().toISOString(),
    rowCount: rows.length,
    hash: hashResultSet(rows),
    rows,
  };
  const filepath = join(snapshotsDir, `${name}.json`);
  await writeFile(filepath, JSON.stringify(snapshot, null, 2));
  return filepath;
}

export interface SnapshotComparison {
  readonly match: boolean;
  readonly expectedHash: string;
  readonly actualHash: string;
  readonly expectedRowCount: number;
  readonly actualRowCount: number;
}

export async function compareSnapshot(
  name: string,
  rows: unknown[],
  snapshotsDir: string,
): Promise<SnapshotComparison> {
  const filepath = join(snapshotsDir, `${name}.json`);

  let raw: string;
  try {
    raw = await readFile(filepath, "utf-8");
  } catch (err) {
    throw new Error(
      `Snapshot file not found: ${filepath}. Run saveSnapshot() first.`,
      { cause: err },
    );
  }

  let snapshot: { hash: string; rowCount: number };
  try {
    snapshot = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Snapshot file is not valid JSON: ${filepath}`, {
      cause: err,
    });
  }

  const actualHash = hashResultSet(rows);

  return {
    match: snapshot.hash === actualHash,
    expectedHash: snapshot.hash,
    actualHash,
    expectedRowCount: snapshot.rowCount,
    actualRowCount: rows.length,
  };
}
