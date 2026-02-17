/**
 * Utilities for parsing and analyzing moose plan output
 */

import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";

const execAsync = promisify(exec);

// Plan output structure from moose plan --json
export interface PlanOutput {
  target_infra_map: {
    default_database: string;
    tables: any;
  };
  changes: {
    olap_changes: Array<Record<string, any>>;
    streaming_engine_changes: Array<Record<string, any>>;
    processes_changes: Array<Record<string, any>>;
    api_changes: Array<Record<string, any>>;
    web_app_changes: Array<Record<string, any>>;
  };
}

/**
 * Constructs a table ID from table object, matching Rust's Table::id() logic.
 * Format: "database_tablename" or "database_tablename_version"
 *
 * This ensures unambiguous table identification in multi-database scenarios.
 *
 * @param table - Table object with name, database, and optional version
 * @param defaultDatabase - Default database to use if table.database is not set
 * @returns Table ID string
 */
export function getTableId(
  table: { name: string; database?: string; version?: string },
  defaultDatabase: string,
): string {
  // Use table's database or fall back to default
  const db = table.database || defaultDatabase;

  // Build base_id with name and optional version
  let baseId = table.name;
  if (table.version) {
    const versionSuffix = table.version.replace(/\./g, "_");
    baseId = `${table.name}_${versionSuffix}`;
  }
  return `${db}_${baseId}`;
}

/**
 * Check if a table was added (Created)
 * Compares by table ID (includes database) for unambiguous identification
 */
export function hasTableAdded(plan: PlanOutput, tableName: string): boolean {
  if (!plan.changes?.olap_changes) return false;
  const defaultDb = plan.target_infra_map?.default_database || "local";

  return plan.changes.olap_changes.some((change) => {
    const tableChange = change.Table;
    if (!tableChange?.Added) return false;

    const tableId = getTableId(tableChange.Added, defaultDb);
    const targetId = getTableId({ name: tableName }, defaultDb);

    return tableId === targetId;
  });
}

/**
 * Check if a table was removed (Dropped)
 * Compares by table ID (includes database) for unambiguous identification
 */
export function hasTableRemoved(plan: PlanOutput, tableName: string): boolean {
  if (!plan.changes?.olap_changes) return false;
  const defaultDb = plan.target_infra_map?.default_database || "local";

  return plan.changes.olap_changes.some((change) => {
    const tableChange = change.Table;
    if (!tableChange?.Removed) return false;

    const tableId = getTableId(tableChange.Removed, defaultDb);
    const targetId = getTableId({ name: tableName }, defaultDb);

    return tableId === targetId;
  });
}

/**
 * Check if a table was updated (column changes, etc.)
 * Compares by table ID (includes database) for unambiguous identification
 */
export function hasTableUpdated(plan: PlanOutput, tableName: string): boolean {
  if (!plan.changes?.olap_changes) return false;
  const defaultDb = plan.target_infra_map?.default_database || "local";

  return plan.changes.olap_changes.some((change) => {
    const tableChange = change.Table;
    if (!tableChange?.Updated) return false;

    const targetId = getTableId({ name: tableName }, defaultDb);

    const beforeId =
      tableChange.Updated.before ?
        getTableId(tableChange.Updated.before, defaultDb)
      : null;
    const afterId =
      tableChange.Updated.after ?
        getTableId(tableChange.Updated.after, defaultDb)
      : null;

    return beforeId === targetId || afterId === targetId;
  });
}

/**
 * Get all table changes for a specific table
 * Compares by table ID (includes database) for unambiguous identification
 */
export function getTableChanges(
  plan: PlanOutput,
  tableName: string,
): Array<{ type: string; details: any }> {
  const results: Array<{ type: string; details: any }> = [];

  if (!plan.changes?.olap_changes) return results;

  const defaultDb = plan.target_infra_map?.default_database || "local";
  const targetId = getTableId({ name: tableName }, defaultDb);

  for (const change of plan.changes.olap_changes) {
    for (const [changeType, details] of Object.entries(change)) {
      if (changeType === "Table") {
        const tableChange = details;
        let matches = false;

        if (tableChange.Added) {
          const tableId = getTableId(tableChange.Added, defaultDb);
          matches = tableId === targetId;
        } else if (tableChange.Removed) {
          const tableId = getTableId(tableChange.Removed, defaultDb);
          matches = tableId === targetId;
        } else if (tableChange.Updated) {
          const beforeId =
            tableChange.Updated.before ?
              getTableId(tableChange.Updated.before, defaultDb)
            : null;
          const afterId =
            tableChange.Updated.after ?
              getTableId(tableChange.Updated.after, defaultDb)
            : null;

          matches = beforeId === targetId || afterId === targetId;
        }

        if (matches) {
          results.push({ type: changeType, details: tableChange });
        }
      }
    }
  }

  return results;
}

/**
 * Run `moose plan --json` against a running moose server and return parsed output.
 *
 * @param pythonVenvDir - If the project is Python, pass the project dir so the
 *   venv's PATH and VIRTUAL_ENV are set. Omit for TypeScript projects.
 */
export async function runMoosePlanJson(
  projectDir: string,
  cliPath: string,
  serverUrl: string,
  adminToken: string,
  pythonVenvDir?: string,
): Promise<PlanOutput> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    // Dummy credentials required for S3Queue secret resolution
    TEST_AWS_ACCESS_KEY_ID: "test-access-key-id",
    TEST_AWS_SECRET_ACCESS_KEY: "test-secret-access-key",
    // Admin token for moose plan --url authentication
    MOOSE_ADMIN_TOKEN: adminToken,
    ...(pythonVenvDir && {
      VIRTUAL_ENV: path.join(pythonVenvDir, ".venv"),
      PATH: `${path.join(pythonVenvDir, ".venv", "bin")}:${process.env.PATH ?? ""}`,
    }),
  };

  try {
    const { stdout } = await execAsync(
      `"${cliPath}" plan --url "${serverUrl}" --json`,
      { cwd: projectDir, env },
    );
    // Debug: log first 500 chars of output to see structure
    console.log(
      "Plan JSON output (first 500 chars):",
      stdout.substring(0, 500),
    );
    const parsed = JSON.parse(stdout) as PlanOutput;
    // Debug: log structure
    console.log("Parsed plan structure:", {
      hasChanges: !!parsed.changes,
      olapChangesLength: parsed.changes?.olap_changes?.length ?? 0,
      changesKeys: parsed.changes ? Object.keys(parsed.changes) : [],
    });
    return parsed;
  } catch (error: any) {
    console.error("moose plan --json failed:");
    console.error("stdout:", error.stdout);
    console.error("stderr:", error.stderr);
    // Try to parse what we got to see structure
    if (error.stdout) {
      try {
        const partial = JSON.parse(error.stdout.substring(0, 1000));
        console.error("Partial JSON structure:", Object.keys(partial));
      } catch (e) {
        // Ignore parse errors
      }
    }
    throw error;
  }
}
